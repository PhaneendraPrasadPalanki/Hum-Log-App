package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var clients = make(map[*websocket.Conn]string)
var avatars = make(map[string]string)
var broadcast = make(chan Message)
var chatHistory []Message
var onlineUsers = make(map[string]bool)
var eventList []Event
var currentTelepathyQuestions []map[string]any
var telepathyAnswers = make(map[string][]string) // username -> answers
var guessBoard []GuessStatement

// Message structure
type Message struct {
	Username        string                    `json:"username"`
	Avatar          string                    `json:"avatar,omitempty"`
	Content         string                    `json:"content"`
	Type            string                    `json:"type"`
	Users           []string                  `json:"users,omitempty"`
	Taken           []string                  `json:"taken,omitempty"`
	Timestamp       string                    `json:"timestamp"`
	Event           *Event                    `json:"event,omitempty"`
	EventID         string                    `json:"eventId,omitempty"`
	Item            any                       `json:"item,omitempty"`    // bucket items
	Answers         []string                  `json:"answers,omitempty"` // instead of map[string]string
	Scores          map[string]map[string]int `json:"scores,omitempty"`  // telepathy scores
	RevealedMessage string                    `json:"revealedMessage,omitempty"`
	ID              string                    `json:"id,omitempty"` // ✅ ADD THIS
}
type GuessStatement struct {
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	Creator  string   `json:"creator"`
	Guesses  []string `json:"guesses"`
	Revealed bool     `json:"revealed"`
}

type Event struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Date        string `json:"date"`
	Start       string `json:"start"`
	End         string `json:"end"`
	CreatedBy   string `json:"createdBy"`
}

func handleTelepathyQuestions(w http.ResponseWriter, r *http.Request) {
	if len(currentTelepathyQuestions) == 0 {
		filePath := "./public/files/Telepathy_Unique_Questions.xlsx"
		f, err := excelize.OpenFile(filePath)
		if err != nil {
			http.Error(w, "Failed to open question file", http.StatusInternalServerError)
			return
		}

		rows, err := f.GetRows("Sheet1")
		if err != nil || len(rows) < 2 {
			http.Error(w, "Invalid Excel format", http.StatusBadRequest)
			return
		}

		// pick 3 random questions (excluding header)
		rand.Shuffle(len(rows)-1, func(i, j int) {
			rows[i+1], rows[j+1] = rows[j+1], rows[i+1]
		})

		selected := rows[1:4] // 3 rows
		for _, row := range selected {
			if len(row) >= 5 {
				q := map[string]any{
					"question": row[0],
					"options":  []string{row[1], row[2], row[3], row[4]},
				}
				currentTelepathyQuestions = append(currentTelepathyQuestions, q)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(currentTelepathyQuestions)
}
func handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer ws.Close()

	var currentUser string

	for _, msg := range chatHistory {
		ws.WriteJSON(msg)
	}

	ws.WriteJSON(Message{
		Type:  "avatars",
		Taken: getTakenAvatars(),
	})

	for _, ev := range eventList {
		ws.WriteJSON(Message{
			Type:  "event",
			Event: &ev,
		})
	}

	for {
		var msg Message
		err := ws.ReadJSON(&msg)
		if err != nil {
			log.Printf("Read error: %v", err)
			delete(clients, ws)
			if currentUser != "" {
				delete(onlineUsers, currentUser)
				delete(avatars, currentUser)

				broadcast <- Message{
					Username:  currentUser,
					Type:      "leave",
					Timestamp: time.Now().Format("03:04 PM"),
				}

				broadcast <- Message{
					Type:  "userlist",
					Users: getUserList(),
				}

				broadcast <- Message{
					Type:  "avatars",
					Taken: getTakenAvatars(),
				}
			}
			break
		}

		msg.Timestamp = time.Now().Format("03:04 PM")

		switch msg.Type {
		case "join":
			currentUser = msg.Username
			clients[ws] = currentUser
			onlineUsers[currentUser] = true
			avatars[currentUser] = msg.Avatar

			broadcast <- msg
			broadcast <- Message{Type: "userlist", Users: getUserList()}
			broadcast <- Message{Type: "avatars", Taken: getTakenAvatars()}

		case "event":
			if msg.Event != nil {
				existing := false
				for i, e := range eventList {
					if e.ID == msg.Event.ID {
						eventList[i] = *msg.Event
						existing = true
						break
					}
				}
				if !existing {
					eventList = append(eventList, *msg.Event)
				}
				broadcast <- msg
			}

		case "event-delete":
			eventList = removeEventByID(msg.EventID)
			broadcast <- msg

		case "bucket-add", "bucket-update":
			broadcast <- msg

		case "telepathy-submit":
			telepathyAnswers[msg.Username] = msg.Answers

			scores := make(map[string]map[string]int)
			users := make([]string, 0, len(telepathyAnswers))
			for u := range telepathyAnswers {
				users = append(users, u)
			}

			for i := 0; i < len(users); i++ {
				for j := i + 1; j < len(users); j++ {
					u1 := users[i]
					u2 := users[j]
					answers1 := telepathyAnswers[u1]
					answers2 := telepathyAnswers[u2]

					matchCount := 0
					for k := 0; k < len(answers1) && k < len(answers2); k++ {
						if answers1[k] == answers2[k] {
							matchCount++
						}
					}

					if scores[u1] == nil {
						scores[u1] = make(map[string]int)
					}
					if scores[u2] == nil {
						scores[u2] = make(map[string]int)
					}

					scores[u1][u2] = matchCount
					scores[u2][u1] = matchCount
				}
			}

			broadcast <- Message{
				Type:   "telepathy-scores",
				Scores: scores,
			}

		case "typing":
			broadcast <- msg

		case "guess-add":
			// Decode msg.Item directly into a GuessStatement
			itemBytes, err := json.Marshal(msg.Item)
			if err != nil {
				log.Println("Error marshalling item:", err)
				return
			}

			var statement GuessStatement
			if err := json.Unmarshal(itemBytes, &statement); err != nil {
				log.Println("Error unmarshalling GuessStatement:", err)
				return
			}

			if statement.Guesses == nil {
				statement.Guesses = []string{}
			}

			guessBoard = append(guessBoard, statement)

			broadcast <- Message{
				Type: "guess-add",
				Item: statement,
			}

		case "guess-attempt":
			id := msg.ID
			guesser := msg.Username
			guess := msg.Content

			for i, s := range guessBoard {
				if s.ID == id {
					// Prevent duplicate guessing
					for _, g := range s.Guesses {
						if g == guesser {
							return
						}
					}

					// Add guess
					guessBoard[i].Guesses = append(s.Guesses, guesser)

					var revealMessage string
					if strings.EqualFold(guess, s.Creator) {
						// Correct guess
						guessBoard[i].Revealed = true
						revealMessage = fmt.Sprintf("🎯 Hey %s, your statement has been revealed by %s! Take the punishment! 😈", s.Creator, guesser)
					}

					// Broadcast update
					broadcast <- Message{
						Type:            "guess-update",
						Item:            guessBoard[i],
						RevealedMessage: revealMessage,
					}
					break
				}
			}

		default:
			msg.Type = "chat"
			if msg.Content != "" {
				chatHistory = append(chatHistory, msg)
				broadcast <- msg
			}
		}
	}
}

func handleMessages() {
	for {
		msg := <-broadcast
		if msg.Avatar == "" && msg.Type != "avatars" {
			msg.Avatar = avatars[msg.Username]
		}
		for client := range clients {
			err := client.WriteJSON(msg)
			if err != nil {
				log.Printf("Send error: %v", err)
				client.Close()
				delete(clients, client)
			}
		}
	}
}

func getUserList() []string {
	users := []string{}
	for username := range onlineUsers {
		users = append(users, username)
	}
	return users
}

func getTakenAvatars() []string {
	taken := []string{}
	for _, avatar := range avatars {
		taken = append(taken, avatar)
	}
	return taken
}

func removeEventByID(id string) []Event {
	result := []Event{}
	for _, e := range eventList {
		if e.ID != id {
			result = append(result, e)
		}
	}
	return result
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(10 << 20)
	file, handler, err := r.FormFile("voice")
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := filepath.Ext(handler.Filename)
	filename := fmt.Sprintf("voice_%d%s", time.Now().UnixNano(), ext)
	filepath := filepath.Join("public/uploads", filename)

	out, err := os.Create(filepath)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, "Failed to write file", http.StatusInternalServerError)
		return
	}

	url := "/uploads/" + filename
	w.Write([]byte(url))
}

func main() {
	http.Handle("/css/", http.StripPrefix("/css/", http.FileServer(http.Dir("./public/css"))))
	http.Handle("/js/", http.StripPrefix("/js/", http.FileServer(http.Dir("./public/js"))))
	http.Handle("/sounds/", http.StripPrefix("/sounds/", http.FileServer(http.Dir("./public/sounds"))))
	http.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir("./public/assets"))))
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./public/uploads"))))
	http.HandleFunc("/telepathy-questions", handleTelepathyQuestions)

	http.Handle("/", http.FileServer(http.Dir("./public")))

	http.HandleFunc("/ws", handleConnections)
	http.HandleFunc("/upload", handleUpload)

	go handleMessages()

	fmt.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
