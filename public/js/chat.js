// js/chat.js

let ws;
const usernameColorMap = {};
let username = "";
let avatar = "";
let takenAvatars = [];
let userAvatarMap = {};
let typingUsers = new Set();
let typingTimers = {};
let mediaRecorder;
let recordedChunks = [];
let events = [];
let editingEventId = null;
let bucketItems = [];
let guessStatements = []; // { id, text, creator, guesses: [], revealed: false }

function logout() {
  localStorage.removeItem("username");
  localStorage.removeItem("avatar");
  sessionStorage.removeItem("hasJoined");
  location.reload();
}
window.logout = logout;

window.onload = function () {
    username = localStorage.getItem("username");
    avatar = localStorage.getItem("avatar");
  
    if (!username || !avatar) {
      showAvatarModal();
    } else {
      initWebSocket();
    }
  
    // Initialize emoji picker (after jQuery and DOM ready)
  $(function () {
    window.emojiPicker = new EmojiPicker({
      emojiable_selector: '[data-emojiable=true]',
      assetsPath: 'https://cdnjs.cloudflare.com/ajax/libs/emoji-picker/1.3.0/img/',
      popupButtonClasses: 'fa fa-smile-o'
    });
    window.emojiPicker.discover();

    // Handle enter key in emoji-enabled contentEditable
  $(document).on('keydown', '.emoji-wysiwyg-editor', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  });
  
    // ✅ Event planner form
    document.getElementById("eventForm").addEventListener("submit", handleEventForm);
    document.getElementById("bucketForm").addEventListener("submit", handleBucketForm);

      
    // Call Birthday Countdown function
      startBirthdayCountdowns();
  };  


function handleBucketForm(e) {
  e.preventDefault();
  const input = document.getElementById("bucketInput");
  const text = input.value.trim();
  if (!text) return;

  const item = {
    id: Date.now().toString(),
    text,
    done: false,
    addedBy: username
  };

  // Send to WebSocket so others see it too
  ws.send(JSON.stringify({
    type: "bucket-add",
    item
  }));

  // Chat shoutout
  ws.send(JSON.stringify({
    type: "chat",
    username,
    avatar,
    content: `added a new bucket list item: "${text}"`,
  }));

  input.value = "";
}

function toggleBucketDone(id) {
  const item = bucketItems.find(i => i.id === id);
  if (!item) return;
  item.done = !item.done;
  renderBucketItems();

  ws.send(JSON.stringify({
    type: "bucket-update",
    item
  }));
}

function renderBucketItems() {
    const ul = document.getElementById("bucketItems");
    ul.innerHTML = "";
    bucketItems.forEach(i => {
      const li = document.createElement("li");
      li.className = `bucket-item ${i.done ? "done" : ""}`;
      li.innerHTML = `
        <label class="bucket-checkbox">
          <input type="checkbox" ${i.done ? "checked" : ""} onchange="toggleBucketDone('${i.id}')">
          <span class="custom-check"></span>
        </label>
        <span class="bucket-text">${i.text}</span>
        <small>— ${i.addedBy}</small>
      `;
      li.classList.add("fade-in");
      ul.appendChild(li);
    });
  }



function handleEventForm(e) {
    e.preventDefault();
    const title = document.getElementById("eventTitle").value.trim();
    const description = document.getElementById("eventDesc").value.trim();
    const date = document.getElementById("eventDate").value;
    const start = document.getElementById("eventStart").value;
    const end = document.getElementById("eventEnd").value;
  
    if (!title || !date || !start || !end) return alert("Please fill in all required fields.");
    if (start >= end) return alert("End time must be after start time.");
  
    const sameDayEvents = events.filter(ev => ev.date === date);
    const overlapping = sameDayEvents.some(ev => (start < ev.end && end > ev.start));
  
    if (overlapping) return alert("There's a time conflict with another event on this day.");
  
    if (editingEventId) {
        const idx = events.findIndex(ev => ev.id === editingEventId);
        if (idx !== -1) {
          events[idx] = { ...events[idx], title, description, date, start, end };
          renderEventCards();
    
          ws.send(JSON.stringify({
            username,
            avatar,
            content: `updated the event: ${title}`,
            type: "chat"
          }));
          ws.send(JSON.stringify({
            type: "event",
            event: events[idx]
          }));
          
        }
        editingEventId = null;
        e.target.querySelector("button[type='submit']").textContent = "Add Event";
      } else {
        const newEvent = {
          id: Date.now().toString(),
          title,
          description,
          date,
          start,
          end,
          createdBy: username
        };
    
  
    events.push(newEvent);
    renderEventCards();
  
    ws.send(JSON.stringify({
      username,
      avatar,
      content: `created a new event: ${title} - <a href='#' onclick="showEventDetail('${newEvent.id}')">View</a>`,
      type: "chat"
    }));
    ws.send(JSON.stringify({
        type: "event",
        event: newEvent
      }));
}
  
    e.target.reset();
}
  
function renderEventCards() {
    const container = document.getElementById("eventCards");
    container.innerHTML = "";
    events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  
    events.forEach(ev => {
      const card = document.createElement("div");
      card.className = "event-card";
    card.setAttribute("data-event-id", ev.id);
      card.innerHTML = `
        <h3>${ev.title}</h3>
        <p>${ev.description}</p>
        <p><strong>Date:</strong> ${ev.date}</p>
        <p><strong>Time:</strong> ${ev.start} - ${ev.end}</p>
        <p><strong>By:</strong> ${ev.createdBy}</p>
        ${ev.createdBy === username ? `
          <div style="margin-top: 10px; display: flex; gap: 10px;">
            <button onclick="editEvent('${ev.id}')">Edit</button>
            <button onclick="deleteEvent('${ev.id}')">Delete</button>
          </div>` : ""}
      `;
      container.appendChild(card);
    });
  }
  function editEvent(id) {
    const ev = events.find(e => e.id === id);
    if (!ev) return;
    editingEventId = ev.id;
    document.getElementById("eventTitle").value = ev.title;
    document.getElementById("eventDesc").value = ev.description;
    document.getElementById("eventDate").value = ev.date;
    document.getElementById("eventStart").value = ev.start;
    document.getElementById("eventEnd").value = ev.end;
    document.querySelector("#eventForm button[type='submit']").textContent = "Update Event";
  }

  function deleteEvent(id) {
    const ev = events.find(e => e.id === id);
    if (!ev || ev.createdBy !== username) return;
    if (!confirm("Are you sure you want to delete this event?")) return;
    events = events.filter(e => e.id !== id);
    renderEventCards();
  
    ws.send(JSON.stringify({
      username,
      avatar,
      content: `deleted the event: ${ev.title}`,
      type: "chat"
    }));
    ws.send(JSON.stringify({
        type: "event-delete",
        eventId: id
      }));      
  }
  
  function showEventDetail(id) {
    showView("events"); // Ensure the event tab is visible
  
    setTimeout(() => {
      const el = document.querySelector(`[data-event-id='${id}']`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add("highlight");
  
        // Remove highlight after 2 seconds
        setTimeout(() => {
          el.classList.remove("highlight");
        }, 2000);
      }
    }, 100); // Small delay to ensure DOM is rendered
  }
  

function showAvatarModal() {
  document.getElementById("avatarModal").style.display = "flex";

  document.querySelectorAll(".avatar-option").forEach(option => {
    option.addEventListener("click", () => {
      document.querySelectorAll(".avatar-option").forEach(opt => opt.classList.remove("selected"));
      option.classList.add("selected");
    });
  });

  document.getElementById("confirmAvatarBtn").addEventListener("click", () => {
    const selected = document.querySelector(".avatar-option.selected");
    const name = document.getElementById("usernameInput").value.trim();

    if (!name || !selected) return alert("Please enter a username and select an avatar");

    username = name;
    avatar = selected.getAttribute("data-avatar");
    localStorage.setItem("username", username);
    localStorage.setItem("avatar", avatar);

    document.getElementById("avatarModal").style.display = "none";
    initWebSocket();
  });
}

function startBirthdayCountdowns() {
    const birthdays = [
      { name: "Rishitha", month: 0, day: 20, avatar: "koala" },
      { name: "Sohail", month: 4, day: 24, avatar: "sloth" },
      { name: "Raj", month: 10, day: 13, avatar: "panda" },
      { name: "Phani", month: 3, day: 8, avatar: "retriever" }
    ];
  
    const container = document.getElementById("birthdayCountdowns");
    container.innerHTML = ""; // ✅ Clear only ONCE
  
    birthdays.forEach(b => {
      const card = document.createElement("div");
      card.className = "flip-card";
      card.innerHTML = `
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="birthday-clock">
              <img src="assets/avatars/${b.avatar}.png" class="clock-avatar" />
              <h3>${b.name}</h3>
              <div class="time-block"><span class="days">--</span><label>Days</label></div>
              <div class="time-block"><span class="hours">--</span><label>Hrs</label></div>
              <div class="time-block"><span class="minutes">--</span><label>Min</label></div>
              <div class="time-block"><span class="seconds">--</span><label>Sec</label></div>
            </div>
          </div>
          <div class="flip-card-back">
            <img src="assets/friends/${b.avatar}.jpg" alt="${b.name}" class="friend-photo" />
            <h3>${b.name}</h3>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  
    function updateCountdowns() {
      const cards = container.querySelectorAll(".flip-card");
  
      cards.forEach((card, i) => {
        const b = birthdays[i];
        const now = new Date();
        const year = (now.getMonth() > b.month || (now.getMonth() === b.month && now.getDate() > b.day))
          ? now.getFullYear() + 1
          : now.getFullYear();
        const next = new Date(year, b.month, b.day);
        const diff = next - now;
  
        const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
        const hours = Math.max(0, Math.floor((diff / (1000 * 60 * 60)) % 24));
        const minutes = Math.max(0, Math.floor((diff / (1000 * 60)) % 60));
        const seconds = Math.max(0, Math.floor((diff / 1000) % 60));
  
        card.querySelector(".days").textContent = String(days).padStart(2, "0");
        card.querySelector(".hours").textContent = String(hours).padStart(2, "0");
        card.querySelector(".minutes").textContent = String(minutes).padStart(2, "0");
        card.querySelector(".seconds").textContent = String(seconds).padStart(2, "0");
      });
    }
  
    updateCountdowns();
    setInterval(updateCountdowns, 1000);
  }
      
  
  

function initWebSocket() {
  document.getElementById("displayUsername").textContent = username;
  document.getElementById("message").focus();

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.onopen = function () {
    const hasJoined = sessionStorage.getItem("hasJoined");
    if (!hasJoined) {
      ws.send(JSON.stringify({ username, avatar, content: "", type: "join" }));
      sessionStorage.setItem("hasJoined", "true");
    }
  };

  ws.onmessage = function (event) {
    const msg = JSON.parse(event.data);
    const chat = document.getElementById("chat");

    if (msg.type === "userlist") {
      updateUserList(msg.users);
      return;
    }

    if (msg.type === "avatars") {
      takenAvatars = msg.taken || [];
      updateAvatarAvailability();
      return;
    }

    if (msg.type === "typing") {
      if (msg.username !== username) {
        addTypingUser(msg.username);
      }
      return;
    }

    if (msg.type === "bucket-add" && msg.item) {
      if (msg.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
        bucketItems.push(msg.item);
        renderBucketItems();
      }
      return;
    }
      
      if (msg.type === "bucket-update" && msg.item) {
        const index = bucketItems.findIndex(i => i.id === msg.item.id);
        if (index !== -1) {
          bucketItems[index] = msg.item;
          renderBucketItems();
        }
        return;
      }
      

    // ✅ Sync event list when someone creates/edits an event
    if (msg.type === "event" && msg.event) {
        const idx = events.findIndex(ev => ev.id === msg.event.id);
        if (idx !== -1) {
        events[idx] = msg.event; // update existing
        } else {
        events.push(msg.event); // add new
        }
        renderEventCards();
        return;
    }
    // 📥 Receive telepathy answer
    if (msg.type === "telepathy-scores" && msg.scores) {
      renderTelepathyResults(msg.scores);
      return;
    }    

    // 🎯 When new guess statement is added
    if (msg.type === "guess-add") {
      guessStatements.push(msg.item);
      renderGuessCards();
      return;
      }

    // ✅ When a guess is attempted
    if (msg.type === "guess-update") {
      const idx = guessStatements.findIndex(s => s.id === msg.item.id);
      if (idx !== -1) {
        guessStatements[idx] = msg.item;
        renderGuessCards();
      }

    // Show group message if someone got it right
      if (msg.revealedMessage) {
      const chat = document.getElementById("chat");
      chat.innerHTML += `<p class="message system-message">${msg.revealedMessage}</p>`;
      chat.scrollTop = chat.scrollHeight;
      }

    return;
    }


  
  // ✅ Remove event when deleted by someone else
  if (msg.type === "event-delete" && msg.eventId) {
    events = events.filter(ev => ev.id !== msg.eventId);
    renderEventCards();
    return;
  }
  

    if (msg.username && msg.avatar) {
      userAvatarMap[msg.username] = msg.avatar;
    }

    if (!usernameColorMap[msg.username]) {
      usernameColorMap[msg.username] = getRandomColor();
    }

    const color = usernameColorMap[msg.username];
    const alignmentClass = msg.username === username ? "me" : "them";
    const avatarImage = `<div class="avatar"><img src="assets/avatars/${msg.avatar || "panda"}.png" alt="avatar" /></div>`;

    if (msg.type === "join") {
      chat.innerHTML += `<p class="message system-message">🟢 ${msg.username} has joined the chat</p>`;
    } else if (msg.type === "leave") {
      chat.innerHTML += `<p class="message system-message">🔴 ${msg.username} has left the chat</p>`;
    } else if (msg.content.endsWith(".ogg")) {
      chat.innerHTML += `
        <div class="message-wrapper ${alignmentClass}">
          <div class="message-row">
            ${msg.username !== username ? avatarImage : ""}
            <div class="message">
              <strong style="color: ${color}">${msg.username}:</strong>
              <audio controls src="${msg.content}" style="margin-top: 4px;"></audio>
            </div>
          </div>
          <div class="timestamp">${msg.timestamp}</div>
        </div>`;
    } else {
      chat.innerHTML += `
        <div class="message-wrapper ${alignmentClass}">
          <div class="message-row">
            ${msg.username !== username ? avatarImage : ""}
            <div class="message">
              <strong style="color: ${color}">${msg.username}:</strong> ${msg.content}
            </div>
          </div>
          <div class="timestamp">${msg.timestamp}</div>
        </div>`;
    }

    if (msg.username !== username) {
      document.getElementById("messageSound").play().catch(() => {});
    }

    chat.scrollTop = chat.scrollHeight;
  };

  const messageInput = document.getElementById("message");

  messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    } else {
      ws.send(JSON.stringify({ username, type: "typing" }));
    }
  });

  document.getElementById("recordBtn").addEventListener("click", toggleRecording);
}

function addTypingUser(user) {
  typingUsers.add(user);
  updateTypingIndicator();

  clearTimeout(typingTimers[user]);
  typingTimers[user] = setTimeout(() => {
    typingUsers.delete(user);
    updateTypingIndicator();
  }, 2000);
}

function updateTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  const names = Array.from(typingUsers);

  if (names.length === 0) {
    indicator.textContent = "";
  } else if (names.length === 1) {
    indicator.textContent = `${names[0]} is typing...`;
  } else {
    indicator.textContent = `${names.join(", ")} are typing...`;
  }
}
function calculateTelepathyScores(allAnswers) {
  const users = Object.keys(allAnswers);
  const scores = {}; // {user: {otherUser: score}}

  users.forEach(user => scores[user] = {});

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const u1 = users[i];
      const u2 = users[j];
      const answers1 = allAnswers[u1];
      const answers2 = allAnswers[u2];
      const matchCount = answers1.filter((ans, idx) => ans === answers2[idx]).length;
      scores[u1][u2] = matchCount;
      scores[u2][u1] = matchCount;
    }
  }

  return scores;
}

function sendMessage() {
  const input = $('.emoji-wysiwyg-editor');
  const content = input.html().trim();
  if (!content) return;

  ws.send(JSON.stringify({ username, avatar, content, type: "chat" }));
  input.html('');
  }

function toggleRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      recordedChunks = [];
      mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
      mediaRecorder.onstop = uploadVoiceNote;
      document.getElementById("recordBtn").textContent = "Stop Recording";
    });
  } else if (mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    document.getElementById("recordBtn").textContent = "Record Voice";
  }
}

function uploadVoiceNote() {
  const blob = new Blob(recordedChunks, { type: "audio/ogg" });
  const formData = new FormData();
  formData.append("voice", blob, "voice.ogg");

  fetch("/upload", {
    method: "POST",
    body: formData
  })
    .then(res => res.text())
    .then(url => {
      ws.send(JSON.stringify({ username, avatar, content: url, type: "chat" }));
    })
    .catch(err => console.error("Upload failed", err));
}

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

function updateUserList(users) {
  const userList = document.getElementById("users");
  userList.innerHTML = "";
  users.forEach(u => {
    const avatar = userAvatarMap[u] || "panda";
    const li = document.createElement("li");
    li.innerHTML = `<img src="assets/avatars/${avatar}.png" alt="avatar" style="width: 20px; height: 20px; border-radius: 50%; margin-right: 8px; vertical-align: middle;"> ${u}`;
    userList.appendChild(li);
  });
}

function updateAvatarAvailability() {
  if (!Array.isArray(takenAvatars)) return;
  document.querySelectorAll(".avatar-option").forEach(option => {
    const avatar = option.getAttribute("data-avatar");
    if (takenAvatars.includes(avatar)) {
      option.classList.add("taken");
      option.style.pointerEvents = "none";
      option.style.opacity = 0.4;
    } else {
      option.classList.remove("taken");
      option.style.pointerEvents = "auto";
      option.style.opacity = 1;
    }
  });
}

//telepathy part of the code

window.telepathyQuestions = [];

function startTelepathyTest() {
  document.getElementById("telepathyIntro").style.display = "none";
  const testArea = document.getElementById("telepathyTestArea");
  const qContainer = document.getElementById("telepathyQuestions");
  qContainer.innerHTML = "Loading questions...";

  fetch("/telepathy-questions")
    .then(res => res.json())
    .then(data => {
      window.telepathyQuestions = data;
      qContainer.innerHTML = "";

      telepathyQuestions.forEach((q, idx) => {
        const div = document.createElement("div");
        div.className = "telepathy-question";
        div.innerHTML = `
          <p><strong>${q.question}</strong></p>
          <div class="options-grid">
            ${q.options.map(opt => `
              <label class="option-btn">
                <input type="radio" name="q${idx}" value="${opt}" required> ${opt}
              </label>
            `).join('')}
          </div>
        `;
        qContainer.appendChild(div);
      });      

      testArea.style.display = "block";
    })
    .catch(err => {
      qContainer.innerHTML = "<p>Failed to load questions. Try again.</p>";
      console.error("Failed to load questions:", err);
    });
}



document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("telepathyForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const answers = window.telepathyQuestions.map((_, idx) => {
        const selected = document.querySelector(`input[name="q${idx}"]:checked`);
        return selected?.value || "";
      });

      ws.send(JSON.stringify({
        type: "telepathy-submit",
        username,
        answers
      }));

      document.getElementById("telepathyTestArea").style.display = "none";
      document.getElementById("telepathyResults").innerHTML = "<p>Waiting for others...</p>";
    });
  }
});



function renderTelepathyResults(scores) {
  const container = document.getElementById("telepathyResults");
  container.innerHTML = "<h2>🧠 Telepathy Test Results</h2>";

  // Step 1: Leaderboard (Top Pair)
  const pairs = [];

  Object.keys(scores).forEach(user1 => {
    Object.keys(scores[user1]).forEach(user2 => {
      if (user1 < user2) {
        pairs.push({
          pair: `${user1} & ${user2}`,
          users: [user1, user2],
          score: scores[user1][user2]
        });
      }
    });
  });

  pairs.sort((a, b) => b.score - a.score);
  const top = pairs[0];
  const topPercent = Math.min((top.score / 3) * 100, 100);

  const leaderboard = document.createElement("div");
  leaderboard.className = "telepathy-leaderboard";
  leaderboard.innerHTML = `
    <div class="top-pair">🏆 ${top.pair} - ${top.score}/3 🏆</div>
    <div class="heart-container">
      <div class="heart-background">❤️</div>
      <div class="heart-fill" style="width: ${topPercent}%">❤️</div>
    </div>
  `;

  container.appendChild(leaderboard);

  // Step 2: User's Own Connections (Only Trophies)
  const myScores = scores[username] || {};
  const section = document.createElement("div");
  section.className = "telepathy-section";

  Object.entries(myScores).forEach(([other, score]) => {
    const trophyRow = "🏆".repeat(score) + "⚫".repeat(3 - score);

    const card = document.createElement("div");
    card.className = "telepathy-card";
    card.innerHTML = `
      <div class="meter-label">${username} ❤️ ${other}</div>
      <div class="trophy-icons">${trophyRow}</div>
    `;
    section.appendChild(card);
  });

  const subheading = document.createElement("h3");
  subheading.textContent = "💖 Your Telepathy Connections";
  subheading.style.color = "#eee";
  subheading.style.marginTop = "20px";

  container.appendChild(subheading);
  container.appendChild(section);
}

// 🎭 Guess Board Logic

function renderGuessCards() {
  const container = document.getElementById("guessStatements");
  container.innerHTML = "";

  guessStatements.forEach(statement => {
    const card = document.createElement("div");
    card.className = "guess-card";

    const alreadyGuessed = statement.guesses.includes(username);
    const isRevealed = statement.revealed;

    card.innerHTML = `
      <p>"${statement.text}"</p>
      ${isRevealed ? `<p style="color:#0f0;">✔️ Revealed: ${statement.creator}</p>` :
      alreadyGuessed ? `<p style="color:#ccc;">❌ You already guessed!</p>` :
      `<button onclick="promptGuess('${statement.id}')">Take a Guess</button>`}
    `;

    container.appendChild(card);
  });
}

function promptGuess(id) {
  const guess = prompt("Who do you think wrote this?");
  if (!guess) return;

  ws.send(JSON.stringify({
    type: "guess-attempt",
    id,
    username,
    content: guess
  }));
}

document.getElementById("guessForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("guessInput");
  const text = input.value.trim();
  if (!text) return;

  const newStatement = {
    id: Date.now().toString(),
    text,
    creator: username,
    guesses: [],
    revealed: false
  };

  ws.send(JSON.stringify({
    type: "guess-add",
    item: newStatement
  }));

  input.value = "";
});


