# 🛠️ How to Run the Application

Follow these steps to get the Guess Board Chat App running on your local machine.

---

## 📦 Prerequisites

- [Go](https://go.dev/doc/install) (v1.18 or later)
- Git
- Web browser (Chrome recommended)

---

## 🚀 Steps to Run

1. **Clone the Repository**
```bash
git clone https://github.com/YOUR_USERNAME/guess-board-chat-app.git
cd guess-board-chat-app
```

2. **Start the Server**
```bash
go run main.go
```

3. **Open the App**
Visit:  
```
http://localhost:8080
```

---

## 📁 Required Files & Folders

Make sure these exist:
- `public/files/Telepathy_Unique_Questions.xlsx` – Excel file with 3+ rows of questions and 4 options each
- `public/uploads/` – Folder for storing voice notes
- `public/assets/avatars/` – Animal avatars
- `public/assets/friends/` – Flip-card images for birthdays

---

## ❓ Troubleshooting

- **WebSocket connection fails**  
  ➤ Make sure you are accessing via `http://localhost:8080` (not `file://`)

- **Voice note upload fails**  
  ➤ Ensure `public/uploads/` directory has write permissions

- **Telepathy questions not loading**  
  ➤ Confirm the Excel file exists and has at least 4 columns: Question, Option A, Option B, Option C, Option D

---

## ✨ Enjoy the Game!

- Share with friends
- Start guessing
- See who has the strongest telepathy!
