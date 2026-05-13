let me = null;
let socket = null;
let activeChatId = null;
let chats = [];
let friendsCache = [];

const $ = (id) => document.getElementById(id);


function toast(title, message = "", type = "info", ms = 4200) {
  const stack = $("toastStack");
  if (!stack) return console.log(title, message);

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = type === "success" ? "✓" : type === "error" ? "!" : type === "warn" ? "⚠" : "✦";

  el.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <strong>${esc(title)}</strong>
      <p>${esc(message)}</p>
    </div>
    <button type="button">×</button>
  `;

  el.querySelector("button").onclick = () => el.remove();
  stack.appendChild(el);

  if (ms) setTimeout(() => el.remove(), ms);
}

function hasSecureMediaAccess() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function getMediaHelpMessage(feature = "microphone") {
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return `Your browser is blocking ${feature} access because this site is using HTTP. Put Chorus behind HTTPS with a domain/SSL, then calls and screen share will work.`;
  }

  return `Your browser does not expose ${feature} access here. Check browser permissions, device permissions, or try Chrome/Edge.`;
}


function chorusConfirm(title, message, onYes) {
  const existing = document.getElementById("chorusConfirmBox");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "chorusConfirmBox";
  wrap.className = "modal";
  wrap.innerHTML = `
    <div class="modal-card">
      <button class="x" id="chorusConfirmNoX">×</button>
      <h2>${esc(title)}</h2>
      <p class="hint">${esc(message)}</p>
      <button id="chorusConfirmYes" class="main-btn">Yes, continue</button>
      <button id="chorusConfirmNo" class="settings-action secondary" style="width:100%;margin-left:0;">Cancel</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector("#chorusConfirmNoX").onclick = close;
  wrap.querySelector("#chorusConfirmNo").onclick = close;
  wrap.querySelector("#chorusConfirmYes").onclick = () => {
    close();
    onYes();
  };
}


function chorusPrompt(title, value, onSave) {
  const existing = document.getElementById("chorusPromptBox");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "chorusPromptBox";
  wrap.className = "modal";
  wrap.innerHTML = `
    <div class="modal-card">
      <button class="x" id="chorusPromptClose">×</button>
      <h2>${esc(title)}</h2>
      <textarea id="chorusPromptInput">${esc(value || "")}</textarea>
      <button id="chorusPromptSave" class="main-btn">Save</button>
      <button id="chorusPromptCancel" class="settings-action secondary" style="width:100%;margin-left:0;">Cancel</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const input = wrap.querySelector("#chorusPromptInput");
  input.focus();
  input.selectionStart = input.selectionEnd = input.value.length;

  const close = () => wrap.remove();
  wrap.querySelector("#chorusPromptClose").onclick = close;
  wrap.querySelector("#chorusPromptCancel").onclick = close;
  wrap.querySelector("#chorusPromptSave").onclick = () => {
    const next = input.value.trim();
    close();
    if (next) onSave(next);
  };
}




const authView = $("authView");
const appView = $("appView");
const authUsername = $("authUsername");
const authDisplayName = $("authDisplayName");
const authPassword = $("authPassword");
const authSubmit = $("authSubmit");
const authError = $("authError");
const loginTab = $("loginTab");
const registerTab = $("registerTab");

const meAvatar = $("meAvatar");
const meName = $("meName");
const meUsername = $("meUsername");
const chatsList = $("chatsList");
const friendsList = $("friendsList");
const requestsList = $("requestsList");
const userSearch = $("userSearch");

const chatAvatar = $("chatAvatar");
const chatTitle = $("chatTitle");
const chatSub = $("chatSub");
const messages = $("messages");
const messageForm = $("messageForm");
const messageInput = $("messageInput");
const deleteChatBtn = $("deleteChatBtn");

let authMode = "login";

function api(path, options = {}) {
  return fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  });
}

function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function setAuthMode(mode) {
  authMode = mode;
  loginTab.classList.toggle("active", mode === "login");
  registerTab.classList.toggle("active", mode === "register");
  authDisplayName.classList.toggle("hidden", mode !== "register");
  authSubmit.textContent = mode === "login" ? "Login" : "Register";
  authError.textContent = "";
}

loginTab.onclick = () => setAuthMode("login");
registerTab.onclick = () => setAuthMode("register");

authSubmit.onclick = async () => {
  try {
    authError.textContent = "";
    const payload = {
      username: authUsername.value,
      password: authPassword.value,
      displayName: authDisplayName.value
    };

    const data = await api(authMode === "login" ? "/api/login" : "/api/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    me = data.user;
    bootApp();
  } catch (err) {
    authError.textContent = err.message.includes("already claimed")
      ? "That username is already taken. Choose another one."
      : err.message;
  }
};

async function checkSession() {
  try {
    const data = await api("/api/me");
    $("bootView").classList.add("hidden");

    if (data.user) {
      me = data.user;
      bootApp();
    } else {
      authView.classList.remove("hidden");
    }
  } catch (err) {
    $("bootView").classList.add("hidden");
    authView.classList.remove("hidden");
  }
}

function bootApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  updateMeUI();
  connectSocket();
  refreshFriends();
  refreshChats();
}

function updateMeUI() {
  meAvatar.src = me.avatar_url || "/default-avatar.svg";
  meName.textContent = me.display_name;
  meUsername.textContent = "@" + me.username;

  $("profileDisplayName").value = me.display_name || "";
  $("profileBio").value = me.bio || "";

  if ($("popoverAvatar")) {
    $("popoverAvatar").src = me.avatar_url || "/default-avatar.svg";
    $("popoverName").textContent = me.display_name || "User";
    $("popoverUsername").textContent = "@" + (me.username || "user");
    $("popoverBio").textContent = me.bio || "No bio yet.";
  }
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io();

  socket.on("chats:update", refreshChats);
  socket.on("friends:update", refreshFriends);

  socket.on("message:new", (msg) => {
    if (Number(msg.chat_id) === Number(activeChatId)) renderMessage(msg, true);
  });

  socket.on("message:edited", (data) => {
    const el = document.querySelector(`[data-message-id="${data.id}"] .msg-text`);
    if (el) {
      el.textContent = data.body;
      const head = document.querySelector(`[data-message-id="${data.id}"] .msg-time`);
      if (head && !head.textContent.includes("edited")) head.textContent += " · edited";
    }
  });

  socket.on("message:deleted", (data) => {
    const el = document.querySelector(`[data-message-id="${data.id}"] .msg-text`);
    if (el) {
      el.textContent = data.body;
      el.classList.add("deleted");
    }
  });

  socket.on("message:reactions", (data) => {
    const box = document.querySelector(`[data-message-id="${data.id}"] .reactions`);
    if (box) box.innerHTML = reactionHTML(data.reactions);
  });
}

$("logoutBtn").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};

$("editProfileBtn").onclick = () => openSettings();
$("openGroupModal").onclick = () => {
  buildGroupChecks();
  $("groupModal").classList.remove("hidden");
};

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.onclick = () => $(btn.dataset.close).classList.add("hidden");
});

$("saveProfileBtn").onclick = async () => {
  try {
    const updated = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: $("profileDisplayName").value,
        bio: $("profileBio").value
      })
    });

    me = updated.user;

    const file = $("avatarFile").files[0];
    if (file) {
      const form = new FormData();
      form.append("avatar", file);
      const avatarData = await api("/api/profile/avatar", {
        method: "POST",
        body: form
      });
      me = avatarData.user;
    }

    updateMeUI();
    $("profileModal").classList.add("hidden");
    await refreshChats();
  } catch (err) {
    toast("Something went wrong", err.message, "error");
  }
};

let searchTimer = null;
userSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 250);
});

async function searchUsers() {
  const q = userSearch.value.trim();
  if (!q) {
    await refreshFriends();
    return;
  }

  const data = await api("/api/search-users?q=" + encodeURIComponent(q));

  friendsList.innerHTML = data.users.map(user => `
    <div class="user-row">
      <img src="${esc(user.avatar_url || "/default-avatar.svg")}" onclick='openProfileView(${JSON.stringify(user)})'>
      <div class="row-main">
        <strong>${esc(user.display_name)}</strong>
        <p>@${esc(user.username)}</p>
      </div>
      <button class="tiny-btn" onclick="sendFriendRequest('${esc(user.username)}')">Add</button>
    </div>
  `).join("") || `<p class="muted">No users found.</p>`;
}

async function sendFriendRequest(username) {
  try {
    await api("/api/friend-requests", {
      method: "POST",
      body: JSON.stringify({ username })
    });
    toast("Friend request sent", "They will see it in their requests.", "success");
    userSearch.value = "";
    refreshFriends();
  } catch (err) {
    toast("Something went wrong", err.message, "error");
  }
}

async function refreshFriends() {
  const data = await api("/api/friends");
  friendsCache = data.friends;

  requestsList.innerHTML = data.incoming.map(req => `
    <div class="user-row">
      <img src="${esc(req.avatar_url || "/default-avatar.svg")}">
      <div class="row-main">
        <strong>${esc(req.display_name)}</strong>
        <p>@${esc(req.username)}</p>
      </div>
      <button class="tiny-btn" onclick="acceptRequest(${req.id})">✓</button>
      <button class="tiny-btn" onclick="declineRequest(${req.id})">×</button>
    </div>
  `).join("") || `<p class="muted">No requests.</p>`;

  friendsList.innerHTML = data.friends.map(friend => `
    <div class="user-row">
      <img src="${esc(friend.avatar_url || "/default-avatar.svg")}" onclick='openProfileView(${JSON.stringify(friend)})'>
      <div class="row-main" onclick="openDm(${friend.id})">
        <strong>${esc(friend.display_name)}</strong>
        <p>@${esc(friend.username)}</p>
      </div>
      <button class="tiny-btn" onclick="openDm(${friend.id})">DM</button>
    </div>
  `).join("") || `<p class="muted">Search a username to add friends.</p>`;
}

async function acceptRequest(id) {
  await api(`/api/friend-requests/${id}/accept`, { method: "POST" });
  refreshFriends();
  refreshChats();
}

async function declineRequest(id) {
  await api(`/api/friend-requests/${id}/decline`, { method: "POST" });
  refreshFriends();
}

async function openDm(userId) {
  const data = await api("/api/chats/dm", {
    method: "POST",
    body: JSON.stringify({ userId })
  });
  await refreshChats();
  openChat(data.chatId);
}

async function refreshChats() {
  const data = await api("/api/chats");
  chats = data.chats;

  chatsList.innerHTML = chats.map(chat => `
    <div class="chat-row ${Number(chat.id) === Number(activeChatId) ? "active" : ""}" onclick="openChat(${chat.id})">
      <img src="${esc(chat.avatar_url || "/default-avatar.svg")}">
      <div class="row-main">
        <strong>${esc(chat.name || "Chat")}</strong>
        <p>${chat.type === "group" ? `${chat.members.length} members` : "direct message"}</p>
      </div>
    </div>
  `).join("") || `<p class="muted">No chats yet.</p>`;
}

async function openChat(chatId) {
  activeChatId = chatId;
  const chat = chats.find(c => Number(c.id) === Number(chatId));

  chatTitle.textContent = chat?.name || "Chat";
  chatAvatar.src = chat?.avatar_url || "/default-avatar.svg";
  chatSub.textContent = chat?.type === "group" ? `${chat.members.length} members` : "direct message";

  messageForm.classList.remove("hidden");
  deleteChatBtn.classList.remove("hidden");
  messages.innerHTML = "";

  socket.emit("join chat", chatId);

  const data = await api(`/api/chats/${chatId}/messages`);
  if (!data.messages.length) {
    messages.innerHTML = `<div class="empty-state"><h2>start the conversation</h2><p>Say something.</p></div>`;
  } else {
    data.messages.forEach(msg => renderMessage(msg, false));
    messages.scrollTop = messages.scrollHeight;
  }

  refreshChats();
}

messageForm.onsubmit = (e) => {
  e.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !activeChatId) return;

  socket.emit("message:send", {
    chatId: activeChatId,
    body
  });

  messageInput.value = "";
};

deleteChatBtn.onclick = async () => {
  if (!activeChatId) return;
  chorusConfirm("Delete chat?", "This deletes the chat for everyone in this starter version.", async () => {
    await api(`/api/chats/${activeChatId}`, { method: "DELETE" });

    activeChatId = null;
    messages.innerHTML = `<div class="empty-state"><h2>chat deleted</h2><p>Open another conversation.</p></div>`;
    messageForm.classList.add("hidden");
    deleteChatBtn.classList.add("hidden");
    chatTitle.textContent = "Welcome to chorus";
    chatSub.textContent = "Pick a chat or add someone by username";
    refreshChats();
  });
};

function renderMessage(msg, scroll) {
  const empty = messages.querySelector(".empty-state");
  if (empty) empty.remove();

  const own = Number(msg.sender_id) === Number(me.id);
  const message = document.createElement("div");
  message.className = "message";
  message.dataset.messageId = msg.id;

  const deleted = Number(msg.is_deleted) === 1;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const edited = msg.edited_at ? " · edited" : "";

  message.innerHTML = `
    <img src="${esc(msg.avatar_url || "/default-avatar.svg")}" />
    <div class="bubble">
      <div class="msg-head">
        <span class="msg-name">${esc(msg.display_name)}</span>
        <span class="msg-time">${time}${edited}</span>
      </div>
      <div class="msg-text ${deleted ? "deleted" : ""}">${esc(msg.body)}</div>
      <div class="msg-actions">
        <span class="reactions">${reactionHTML(msg.reactions || [])}</span>
        <button onclick="reactToMessage(${msg.id}, '❤️')">❤️</button>
        <button onclick="reactToMessage(${msg.id}, '😭')">😭</button>
        <button onclick="reactToMessage(${msg.id}, '💀')">💀</button>
        ${own && !deleted ? `<button onclick="editMessage(${msg.id})">edit</button><button onclick="deleteMessage(${msg.id})">delete</button>` : ""}
      </div>
    </div>
  `;

  const userData = {
    id: msg.sender_id,
    username: msg.username,
    display_name: msg.display_name,
    bio: msg.bio,
    avatar_url: msg.avatar_url
  };

  message.querySelector("img").onclick = () => openProfileView(userData);
  message.querySelector(".msg-name").onclick = () => openProfileView(userData);

  messages.appendChild(message);

  if (scroll && Number(msg.sender_id) !== Number(me.id)) {
    playMessageSound();
  }

  if (scroll) messages.scrollTop = messages.scrollHeight;
}

function reactionHTML(reactions) {
  return reactions.map(r => `<button class="reaction">${esc(r.emoji)} ${r.count}</button>`).join("");
}

function reactToMessage(messageId, emoji) {
  socket.emit("message:react", { messageId, emoji });
}

function editMessage(messageId) {
  const el = document.querySelector(`[data-message-id="${messageId}"] .msg-text`);
  if (!el) return;

  chorusPrompt("Edit message", el.textContent, (next) => {
    socket.emit("message:edit", {
      messageId,
      body: next.trim()
    });
  });
}

function deleteMessage(messageId) {
  chorusConfirm("Delete message?", "This will remove the message text from the chat.", () => {
    socket.emit("message:delete", { messageId });
  });
}

function openProfileView(user) {
  $("viewAvatar").src = user.avatar_url || "/default-avatar.svg";
  $("viewName").textContent = user.display_name || "User";
  $("viewUsername").textContent = "@" + (user.username || "user");
  $("viewBio").textContent = user.bio || "No bio yet.";
  $("profileViewModal").classList.remove("hidden");
}

function buildGroupChecks() {
  $("groupFriendChecks").innerHTML = friendsCache.map(friend => `
    <label class="check-line">
      <input type="checkbox" value="${friend.id}">
      <img src="${esc(friend.avatar_url || "/default-avatar.svg")}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">
      <span>${esc(friend.display_name)} <small class="muted">@${esc(friend.username)}</small></span>
    </label>
  `).join("") || `<p class="muted">Add friends first.</p>`;
}

$("createGroupBtn").onclick = async () => {
  try {
    const checked = [...document.querySelectorAll("#groupFriendChecks input:checked")].map(x => Number(x.value));
    const data = await api("/api/chats/group", {
      method: "POST",
      body: JSON.stringify({
        name: $("groupName").value,
        memberIds: checked
      })
    });

    $("groupModal").classList.add("hidden");
    $("groupName").value = "";
    await refreshChats();
    openChat(data.chatId);
  } catch (err) {
    toast("Something went wrong", err.message, "error");
  }
};




/* CHORUS AUDIO CALLING + SCREEN SHARE
   Requires HTTPS for microphone/camera/screen share on most browsers.
*/
let rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" }
  ],
  iceCandidatePoolSize: 10
};

async function loadRtcConfig() {
  const forceRelay = false;

  try {
    const data = await api("/api/ice-servers");

    if (data.iceServers && Array.isArray(data.iceServers) && data.iceServers.length) {
      const hasTurn = data.hasTurn || data.iceServers.some((server) => JSON.stringify(server.urls || "").includes("turn:"));

      rtcConfig = {
        iceServers: data.iceServers,
        iceCandidatePoolSize: 10
      };

      if (forceRelay) {
        if (!hasTurn) {
          toast("TURN is not connected", "Railway is still only returning STUN. Check your METERED variables, redeploy, then refresh.", "error", 12000);
          throw new Error("Force TURN relay is on, but /api/ice-servers returned no TURN servers.");
        }

        rtcConfig.iceTransportPolicy = "relay";
      }

      console.log("Loaded ICE servers:", data.source, rtcConfig);
      return rtcConfig;
    }
  } catch (err) {
    console.warn("Could not load ICE servers:", err);

    if (forceRelay) {
      toast("TURN failed to load", err.message || "Check Railway variables and redeploy.", "error", 12000);
      throw err;
    }
  }

  if (forceRelay) {
    throw new Error("Force TURN relay is on, but no TURN server was loaded.");
  }

  return rtcConfig;
}

let activeCall = {
  chatId: null,
  peerUserId: null,
  peer: null,
  localStream: null,
  screenStream: null,
  callType: "audio",
  incomingOffer: null,
  incomingFrom: null,
  isMuted: false,
  cameraOff: false,
  pendingIce: []
};

function getChatOtherUser(chatId) {
  const chat = chats.find(c => Number(c.id) === Number(chatId));
  if (!chat) return null;
  return chat.members.find(m => Number(m.id) !== Number(me.id)) || null;
}

function getCallableUsers(chatId) {
  const chat = chats.find(c => Number(c.id) === Number(chatId));
  if (!chat) return [];
  return chat.members.filter(m => Number(m.id) !== Number(me.id));
}

function showCallUI(title, status, user) {
  $("callModal").classList.remove("hidden");
  $("incomingCallBox").classList.add("hidden");
  $("callTitle").textContent = title || "chorus call";
  $("callStatus").textContent = status || "connecting...";
  $("callName").textContent = user?.display_name || "chorus user";
  $("callAvatar").src = user?.avatar_url || "/default-avatar.svg";
}

function setAudioOnly(isAudioOnly) {
  $("audioOnlyView").classList.toggle("hidden", !isAudioOnly);
}

async function getAudioStream() {
  if (!hasSecureMediaAccess()) {
    throw new Error(getMediaHelpMessage("microphone"));
  }

  const selectedMic = localStorage.getItem("chorusMicId") || "";
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: selectedMic ? { exact: selectedMic } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
}

async function getScreenStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error(getMediaHelpMessage("screen share"));
  }

  return await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: true
  });
}

function createPeerConnection(peerUserId, chatId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("call:ice", {
        chatId,
        toUserId: peerUserId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    const remoteVideo = $("remoteVideo");
    const remoteAudio = $("remoteAudio");

    const hasAudio = stream.getAudioTracks().length > 0;
    const hasVideo = stream.getVideoTracks().length > 0;

    // Audio-only calls play through a dedicated audio element.
    // This fixes cases where a hidden/no-video <video> element does not output sound.
    if (hasAudio && remoteAudio) {
      remoteAudio.srcObject = stream;
      remoteAudio.muted = false;
      remoteAudio.volume = (chorusSettings?.outputVolume ?? 100) / 100;
      remoteAudio.play().catch(() => {
        toast("Tap the call window", "Your browser blocked autoplay audio. Tap the call window once to start sound.", "warn", 7000);
      });
    }

    // Screen share/video still goes to the video element.
    if (hasVideo && remoteVideo) {
      remoteVideo.srcObject = stream;
      remoteVideo.muted = false;
      remoteVideo.volume = (chorusSettings?.outputVolume ?? 100) / 100;
      remoteVideo.play().catch(() => {});
    }

    setAudioOnly(!hasVideo);
    $("callStatus").textContent = hasVideo ? "screen share connected" : "audio connected";
    $("callQuality").textContent = hasVideo ? "HD screen" : "crisp audio";
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
    if (pc.iceConnectionState === "checking") $("callStatus").textContent = "connecting audio...";
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      stopCallTone();
      $("callStatus").textContent = "connected";
    }
    if (pc.iceConnectionState === "failed") {
      showCallTroubleshooting("connection failed");
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Peer state:", pc.connectionState);
    if (pc.connectionState === "connecting") $("callStatus").textContent = "connecting audio...";
    if (pc.connectionState === "connected") {
      stopCallTone();
      $("callStatus").textContent = "connected";
    }
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      showCallTroubleshooting(pc.connectionState);
    }
    if (pc.connectionState === "closed") {
      $("callStatus").textContent = "closed";
    }
  };

  return pc;
}


async function flushPendingIce() {
  if (!activeCall.peer || !activeCall.pendingIce || !activeCall.pendingIce.length) return;

  const queued = [...activeCall.pendingIce];
  activeCall.pendingIce = [];

  for (const candidate of queued) {
    try {
      await activeCall.peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("Queued ICE candidate failed:", err);
    }
  }
}

function showCallTroubleshooting(text) {
  $("callStatus").textContent = text;
  toast("Call needs TURN", "This connection could not go peer-to-peer. Add the TURN variables on Railway, then turn on Force TURN relay in Settings > Audio.", "warn", 12000);
}

async function startCall(callType = "audio") {
  if (!activeChatId) return toast("Open a chat first", "Choose a DM or group before calling.", "warn");

  const users = getCallableUsers(activeChatId);
  if (!users.length) return toast("Nobody to call", "Add someone to this chat first.", "warn");

  // Starter version calls the first other user in the chat.
  // For group chats, every member gets an incoming call invite.
  const firstUser = users[0];

  activeCall.chatId = activeChatId;
  activeCall.peerUserId = firstUser.id;
  activeCall.callType = callType;

  showCallUI(callType === "screen" ? "chorus screen share" : "chorus audio call", "starting...", firstUser);
  setAudioOnly(callType !== "screen");

  try {
    activeCall.localStream = await getAudioStream();

    if (!activeCall.localStream.getAudioTracks().length) {
      toast("No microphone audio", "Your browser did not give Chorus a microphone track.", "error", 7000);
      endCall(false);
      return;
    }

    if (callType === "screen") {
      activeCall.screenStream = await getScreenStream();
      $("localVideo").srcObject = activeCall.screenStream;
    } else {
      $("localVideo").srcObject = activeCall.localStream;
    }

    const pc = createPeerConnection(firstUser.id, activeChatId);
    activeCall.peer = pc;

    activeCall.localStream.getTracks().forEach(track => pc.addTrack(track, activeCall.localStream));

    if (activeCall.screenStream) {
      activeCall.screenStream.getVideoTracks().forEach(track => pc.addTrack(track, activeCall.screenStream));
      activeCall.screenStream.getVideoTracks()[0].onended = () => stopScreenShareOnly();
    }

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });

    await pc.setLocalDescription(offer);

    socket.emit("call:offer", {
      chatId: activeChatId,
      toUserId: firstUser.id,
      offer,
      callType
    });

    $("callStatus").textContent = "ringing...";
    startCallTone();
  } catch (err) {
    toast("Call cannot start", err.message || "Check TURN setup and microphone permissions.", "error", 12000);
    endCall(false);
  }
}

async function acceptIncomingCall() {
  stopCallTone();
  const data = activeCall.incomingOffer;
  if (!data) return;

  activeCall.chatId = data.chatId;
  activeCall.peerUserId = data.fromUserId;
  activeCall.callType = data.callType || "audio";

  $("incomingCallBox").classList.add("hidden");
  showCallUI(data.callType === "screen" ? "chorus screen share" : "chorus audio call", "connecting...", data.fromUser);
  setAudioOnly(data.callType !== "screen");

  try {
    activeCall.localStream = await getAudioStream();

    if (!activeCall.localStream.getAudioTracks().length) {
      toast("No microphone audio", "Your browser did not give Chorus a microphone track.", "error", 7000);
      declineIncomingCall();
      return;
    }

    $("localVideo").srcObject = activeCall.localStream;

    const pc = createPeerConnection(data.fromUserId, data.chatId);
    activeCall.peer = pc;

    activeCall.localStream.getTracks().forEach(track => pc.addTrack(track, activeCall.localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    await flushPendingIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("call:answer", {
      chatId: data.chatId,
      toUserId: data.fromUserId,
      answer
    });

    $("callStatus").textContent = "connecting audio...";
    await flushPendingIce();
  } catch (err) {
    toast("Could not accept call", err.message || "Check TURN setup and microphone permissions.", "error", 12000);
    declineIncomingCall();
  }
}

function declineIncomingCall() {
  stopCallTone();
  if (activeCall.incomingOffer) {
    socket.emit("call:decline", {
      chatId: activeCall.incomingOffer.chatId,
      toUserId: activeCall.incomingOffer.fromUserId
    });
  }

  resetCallState();
}

async function addScreenShareToCall() {
  if (!activeCall.peer || !activeCall.localStream) {
    return startCall("screen");
  }

  try {
    activeCall.screenStream = await getScreenStream();
    $("localVideo").srcObject = activeCall.screenStream;

    const videoTrack = activeCall.screenStream.getVideoTracks()[0];
    const sender = activeCall.peer.getSenders().find(s => s.track && s.track.kind === "video");

    if (sender) {
      await sender.replaceTrack(videoTrack);
    } else {
      activeCall.peer.addTrack(videoTrack, activeCall.screenStream);
    }

    videoTrack.onended = () => stopScreenShareOnly();
    $("callStatus").textContent = "sharing screen";
    $("callQuality").textContent = "HD screen";
    setAudioOnly(false);

    const offer = await activeCall.peer.createOffer();
    await activeCall.peer.setLocalDescription(offer);

    socket.emit("call:offer", {
      chatId: activeCall.chatId,
      toUserId: activeCall.peerUserId,
      offer,
      callType: "screen"
    });
  } catch (err) {
    toast("Screen share blocked", err.message, "error", 9000);
  }
}

function stopScreenShareOnly() {
  if (activeCall.screenStream) {
    activeCall.screenStream.getTracks().forEach(t => t.stop());
    activeCall.screenStream = null;
  }

  $("localVideo").srcObject = activeCall.localStream || null;
  $("callQuality").textContent = "crisp audio";
}

function toggleMute() {
  if (!activeCall.localStream) return;
  activeCall.isMuted = !activeCall.isMuted;
  activeCall.localStream.getAudioTracks().forEach(track => track.enabled = !activeCall.isMuted);
  $("muteBtn").classList.toggle("off", activeCall.isMuted);
}

function toggleCameraOrVideo() {
  const stream = activeCall.screenStream || activeCall.localStream;
  if (!stream) return;
  const videoTracks = stream.getVideoTracks();
  if (!videoTracks.length) return toast("No video active", "Start screen sharing first.", "warn");

  activeCall.cameraOff = !activeCall.cameraOff;
  videoTracks.forEach(track => track.enabled = !activeCall.cameraOff);
  $("cameraBtn").classList.toggle("off", activeCall.cameraOff);
}

function endCall(notify = true) {
  if (notify && activeCall.chatId) {
    socket.emit("call:end", { chatId: activeCall.chatId });
  }

  if (activeCall.peer) activeCall.peer.close();
  if (activeCall.localStream) activeCall.localStream.getTracks().forEach(t => t.stop());
  if (activeCall.screenStream) activeCall.screenStream.getTracks().forEach(t => t.stop());

  resetCallState();
}

function resetCallState() {
  stopCallTone();
  $("callModal").classList.add("hidden");
  $("incomingCallBox").classList.add("hidden");
  $("remoteVideo").srcObject = null;
  if ($("remoteAudio")) $("remoteAudio").srcObject = null;
  $("localVideo").srcObject = null;
  if ($("acceptCallBtn")) {
    $("acceptCallBtn").disabled = false;
    $("acceptCallBtn").textContent = "Accept";
  }
  $("muteBtn").classList.remove("off");
  $("cameraBtn").classList.remove("off");

  activeCall = {
    chatId: null,
    peerUserId: null,
    peer: null,
    localStream: null,
    screenStream: null,
    callType: "audio",
    incomingOffer: null,
    incomingFrom: null,
    isMuted: false,
    cameraOff: false,
    pendingIce: []
  };
}

$("audioCallBtn").onclick = () => startCall("audio");
$("screenShareBtn").onclick = () => startCall("screen");
$("acceptCallBtn").onclick = acceptIncomingCall;
$("declineCallBtn").onclick = declineIncomingCall;
$("muteBtn").onclick = toggleMute;
$("cameraBtn").onclick = toggleCameraOrVideo;
$("shareBtn").onclick = addScreenShareToCall;
$("endCallBtn").onclick = () => endCall(true);

// Patch existing openChat so call buttons appear when a chat opens.
const chorusOriginalOpenChat = openChat;
openChat = async function(chatId) {
  await chorusOriginalOpenChat(chatId);
  $("audioCallBtn").classList.remove("hidden");
  $("screenShareBtn").classList.remove("hidden");
};

// Add call socket events after socket connects.
const chorusOriginalConnectSocket = connectSocket;
connectSocket = function() {
  chorusOriginalConnectSocket();

  socket.on("call:incoming", (data) => {
    if (activeCall.peer || activeCall.incomingOffer) return;
    startCallTone();
    activeCall.incomingFrom = data.fromUser;
    showCallUI("incoming chorus call", "incoming...", data.fromUser);
    $("incomingCallText").textContent = `${data.fromUser.display_name} is calling you`;
    $("incomingCallBox").classList.remove("hidden");
    setAudioOnly(data.callType !== "screen");
  });

  socket.on("call:offer", async (data) => {
    // If we already have a peer, this is a renegotiation, usually screen share.
    if (activeCall.peer && Number(activeCall.peerUserId) === Number(data.fromUserId)) {
      await activeCall.peer.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await activeCall.peer.createAnswer();
      await activeCall.peer.setLocalDescription(answer);
      socket.emit("call:answer", {
        chatId: data.chatId,
        toUserId: data.fromUserId,
        answer
      });
      return;
    }

    startCallTone();
    activeCall.incomingOffer = data;
    activeCall.incomingFrom = data.fromUser;
    showCallUI("incoming chorus call", "incoming...", data.fromUser);
    $("incomingCallText").textContent = `${data.fromUser.display_name} is calling you`;
    $("incomingCallBox").classList.remove("hidden");
    setAudioOnly(data.callType !== "screen");
  });

  socket.on("call:answer", async (data) => {
    if (!activeCall.peer) return;
    await activeCall.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    $("callStatus").textContent = "connected";
  });

  socket.on("call:ice", async (data) => {
    if (!data.candidate) return;

    if (!activeCall.peer || !activeCall.peer.remoteDescription) {
      activeCall.pendingIce = activeCall.pendingIce || [];
      activeCall.pendingIce.push(data.candidate);
      return;
    }

    try {
      await activeCall.peer.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn("ICE candidate failed:", err);
      activeCall.pendingIce = activeCall.pendingIce || [];
      activeCall.pendingIce.push(data.candidate);
    }
  });

  socket.on("call:end", () => {
    endCall(false);
  });

  socket.on("call:declined", () => {
    toast("Call declined", "The other user declined the call.", "warn");
    endCall(false);
  });
};



/* CHORUS SETTINGS, DEVICE PICKERS, PROFILE POPOVER, AND SOUNDS */
const chorusSettings = {
  micId: localStorage.getItem("chorusMicId") || "",
  speakerId: localStorage.getItem("chorusSpeakerId") || "",
  inputVolume: Number(localStorage.getItem("chorusInputVolume") || 100),
  outputVolume: Number(localStorage.getItem("chorusOutputVolume") || 100),
  messageSounds: localStorage.getItem("chorusMessageSounds") !== "false",
  messageVolume: Number(localStorage.getItem("chorusMessageVolume") || 70),
  messageSound: localStorage.getItem("chorusMessageSound") || "soft",
  callSounds: localStorage.getItem("chorusCallSounds") !== "false",
  callVolume: Number(localStorage.getItem("chorusCallVolume") || 75),
  callSound: localStorage.getItem("chorusCallSound") || "ring"
};

let soundContext = null;
let callToneTimer = null;

function getSoundContext() {
  if (!soundContext) {
    soundContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (soundContext.state === "suspended") soundContext.resume();
  return soundContext;
}

function playTone(freq = 620, duration = 0.08, volume = 0.35, type = "sine") {
  try {
    const ctx = getSoundContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch {}
}

function playMessageSound() {
  if (!chorusSettings.messageSounds) return;
  const vol = chorusSettings.messageVolume / 100;

  if (chorusSettings.messageSound === "ping") {
    playTone(880, 0.07, 0.22 * vol, "sine");
    setTimeout(() => playTone(1175, 0.06, 0.16 * vol, "sine"), 70);
  } else if (chorusSettings.messageSound === "chime") {
    playTone(660, 0.08, 0.2 * vol, "triangle");
    setTimeout(() => playTone(990, 0.09, 0.18 * vol, "triangle"), 90);
  } else {
    playTone(520, 0.055, 0.16 * vol, "sine");
  }
}

function playCallSoundOnce() {
  if (!chorusSettings.callSounds) return;
  const vol = chorusSettings.callVolume / 100;

  if (chorusSettings.callSound === "pulse") {
    playTone(440, 0.12, 0.18 * vol, "sine");
    setTimeout(() => playTone(440, 0.12, 0.14 * vol, "sine"), 220);
  } else if (chorusSettings.callSound === "glow") {
    playTone(523, 0.16, 0.18 * vol, "triangle");
    setTimeout(() => playTone(784, 0.18, 0.16 * vol, "triangle"), 180);
  } else {
    playTone(640, 0.12, 0.2 * vol, "sine");
    setTimeout(() => playTone(840, 0.12, 0.18 * vol, "sine"), 170);
  }
}

function startCallTone() {
  stopCallTone();
  playCallSoundOnce();
  callToneTimer = setInterval(playCallSoundOnce, 1800);
}

function stopCallTone() {
  if (callToneTimer) clearInterval(callToneTimer);
  callToneTimer = null;
}

function openSettings() {
  $("settingsModal").classList.remove("hidden");
  applySettingsUI();
  loadAudioDevices();
}

function applySettingsUI() {
  $("inputVolume").value = chorusSettings.inputVolume;
  $("outputVolume").value = chorusSettings.outputVolume;
  $("messageSoundsToggle").checked = chorusSettings.messageSounds;
  $("messageVolume").value = chorusSettings.messageVolume;
  $("messageSoundSelect").value = chorusSettings.messageSound;
  $("callSoundsToggle").checked = chorusSettings.callSounds;
  $("callVolume").value = chorusSettings.callVolume;
  $("callSoundSelect").value = chorusSettings.callSound;
}

async function loadAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    toast("Audio devices blocked", getMediaHelpMessage("audio device"), "warn", 7000);
    return;
  }

  try {
    // Ask permission once so device names show instead of blank labels.
    await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => {});

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");
    const speakers = devices.filter(d => d.kind === "audiooutput");

    $("micSelect").innerHTML = mics.map((d, i) => `
      <option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>
    `).join("");

    $("speakerSelect").innerHTML = speakers.map((d, i) => `
      <option value="${esc(d.deviceId)}">${esc(d.label || `Speaker ${i + 1}`)}</option>
    `).join("");

    if (chorusSettings.micId) $("micSelect").value = chorusSettings.micId;
    if (chorusSettings.speakerId) $("speakerSelect").value = chorusSettings.speakerId;
  } catch (err) {
    console.warn("Could not load audio devices:", err);
  }
}

function saveSetting(key, value) {
  chorusSettings[key] = value;
  const storageKey = "chorus" + key.charAt(0).toUpperCase() + key.slice(1);
  localStorage.setItem(storageKey, String(value));
}

document.querySelectorAll(".settings-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".settings-section").forEach(x => x.classList.remove("active"));

    btn.classList.add("active");
    $("settings" + btn.dataset.settingsTab.charAt(0).toUpperCase() + btn.dataset.settingsTab.slice(1)).classList.add("active");
  });
});

$("refreshDevicesBtn").onclick = loadAudioDevices;

$("micSelect").onchange = () => {
  saveSetting("micId", $("micSelect").value);
  localStorage.setItem("chorusMicId", $("micSelect").value);
};

$("speakerSelect").onchange = async () => {
  saveSetting("speakerId", $("speakerSelect").value);
  localStorage.setItem("chorusSpeakerId", $("speakerSelect").value);

  const remote = $("remoteVideo");
  if (remote?.setSinkId) {
    try {
      await remote.setSinkId($("speakerSelect").value);
    } catch (err) {
      toast("Output switching blocked", "Your browser blocked changing the speaker output.", "warn");
    }
  } else {
    toast("Not supported", "This browser does not support choosing an output device.", "warn");
  }
};

$("inputVolume").oninput = () => saveSetting("inputVolume", Number($("inputVolume").value));
$("outputVolume").oninput = () => {
  saveSetting("outputVolume", Number($("outputVolume").value));
  $("remoteVideo").volume = chorusSettings.outputVolume / 100;
};

$("messageSoundsToggle").onchange = () => saveSetting("messageSounds", $("messageSoundsToggle").checked);
$("messageVolume").oninput = () => saveSetting("messageVolume", Number($("messageVolume").value));
$("messageSoundSelect").onchange = () => saveSetting("messageSound", $("messageSoundSelect").value);
$("testMessageSoundBtn").onclick = playMessageSound;

$("callSoundsToggle").onchange = () => saveSetting("callSounds", $("callSoundsToggle").checked);
$("callVolume").oninput = () => saveSetting("callVolume", Number($("callVolume").value));
$("callSoundSelect").onchange = () => saveSetting("callSound", $("callSoundSelect").value);
$("testCallSoundBtn").onclick = playCallSoundOnce;

$("settingsEditProfileBtn").onclick = () => {
  $("settingsModal").classList.add("hidden");
  $("profileModal").classList.remove("hidden");
};

$("meAvatar").onclick = (event) => {
  event.stopPropagation();
  $("profilePopover").classList.toggle("hidden");
  updateMeUI();
};

$("popoverEditProfile").onclick = () => {
  $("profilePopover").classList.add("hidden");
  $("profileModal").classList.remove("hidden");
};

$("popoverSettings").onclick = () => {
  $("profilePopover").classList.add("hidden");
  openSettings();
};

document.addEventListener("click", (event) => {
  const pop = $("profilePopover");
  if (!pop || pop.classList.contains("hidden")) return;
  if (pop.contains(event.target) || event.target === $("meAvatar")) return;
  pop.classList.add("hidden");
});

$("avatarFile").addEventListener("change", () => {
  const file = $("avatarFile").files[0];
  $("avatarFileName").textContent = file ? file.name : "No file selected";
});

// Apply output volume to remote call audio/video whenever possible.
setInterval(() => {
  const remote = $("remoteVideo");
  const remoteAudio = $("remoteAudio");
  if (remote) remote.volume = chorusSettings.outputVolume / 100;
  if (remoteAudio) remoteAudio.volume = chorusSettings.outputVolume / 100;
}, 1000);


// Some browsers block remote audio autoplay until the user taps/clicks once.
$("callModal").addEventListener("click", () => {
  const remoteVideo = $("remoteVideo");
  const remoteAudio = $("remoteAudio");
  if (remoteVideo && remoteVideo.srcObject) remoteVideo.play().catch(() => {});
  if (remoteAudio && remoteAudio.srcObject) remoteAudio.play().catch(() => {});
});


/* MOBILE SIDEBAR TOGGLE */
function isMobileView() {
  return window.matchMedia("(max-width: 720px)").matches;
}

const railChatButton = document.querySelector(".rail-icon.active");
if (railChatButton) {
  railChatButton.addEventListener("click", () => {
    if (isMobileView()) document.querySelector(".sidebar")?.classList.toggle("mobile-open");
  });
}

// Close mobile sidebar after selecting a chat/friend/request.
document.addEventListener("click", (event) => {
  if (!isMobileView()) return;
  const row = event.target.closest(".chat-row, .user-row");
  if (row) document.querySelector(".sidebar")?.classList.remove("mobile-open");
});


/* FORCE TURN RELAY SETTING */
if ($("forceRelayToggle")) {
  $("forceRelayToggle").checked = false;
  $("forceRelayToggle").onchange = () => {
    localStorage.setItem("chorusForceRelay", $("forceRelayToggle").checked ? "true" : "false");
    toast(
      $("forceRelayToggle").checked ? "Force TURN enabled" : "Force TURN disabled",
      "Restart the call for this setting to apply.",
      "success",
      5000
    );
  };
}


/* ============================================================
   RELAY AUDIO CALL MODE
   This replaces WebRTC audio with server-relayed audio chunks.
   It is less "crisp" than WebRTC but much easier to connect on
   strict Wi-Fi/cellular networks because it uses your existing
   HTTPS/WebSocket connection.
============================================================ */
let relayRecorder = null;
let relayStream = null;
let relayAudioQueue = [];
let relayPlaying = false;
let relayCallActive = false;
let relayPeerUserId = null;

function getSupportedRelayMime() {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];

  for (const option of options) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(option)) return option;
  }

  return "";
}

async function startRelayVoice(chatId, peerUserId) {
  relayPeerUserId = peerUserId || relayPeerUserId;
  relayCallActive = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Your browser does not allow microphone access here. Use HTTPS and Chrome/Edge/Safari.");
  }

  if (!relayStream) {
    relayStream = await getAudioStream();
  }

  const tracks = relayStream.getAudioTracks();
  if (!tracks.length) {
    throw new Error("No microphone track was provided by your browser.");
  }

  socket.emit("voice:join", { chatId });

  if (relayRecorder && relayRecorder.state !== "inactive") return;

  const mimeType = getSupportedRelayMime();
  relayRecorder = new MediaRecorder(relayStream, mimeType ? { mimeType } : undefined);

  relayRecorder.ondataavailable = async (event) => {
    if (!relayCallActive || !event.data || event.data.size <= 0) return;

    const arrayBuffer = await event.data.arrayBuffer();

    socket.emit("voice:chunk", {
      chatId,
      mimeType: event.data.type || mimeType || "audio/webm",
      chunk: arrayBuffer
    });
  };

  relayRecorder.onerror = (event) => {
    console.warn("Relay recorder error:", event);
    toast("Mic stream error", "Your microphone stream stopped. End and restart the call.", "error", 7000);
  };

  relayRecorder.start(220);

  $("callStatus").textContent = "connected";
  $("callQuality").textContent = "relay audio";
  toast("Relay audio connected", "This call is using server-relayed audio instead of WebRTC.", "success", 4500);
}

function stopRelayVoice(sendLeave = true) {
  relayCallActive = false;

  try {
    if (relayRecorder && relayRecorder.state !== "inactive") relayRecorder.stop();
  } catch {}

  relayRecorder = null;

  if (relayStream) {
    relayStream.getTracks().forEach(track => track.stop());
  }

  relayStream = null;

  if (sendLeave && activeCall.chatId) {
    socket.emit("voice:leave", { chatId: activeCall.chatId });
  }

  relayAudioQueue = [];
  relayPlaying = false;
}

function enqueueRelayAudio(arrayBuffer, mimeType) {
  if (!relayCallActive && !$("callModal").classList.contains("hidden")) {
    relayCallActive = true;
  }

  relayAudioQueue.push({ arrayBuffer, mimeType: mimeType || "audio/webm" });
  playNextRelayChunk();
}

async function playNextRelayChunk() {
  if (relayPlaying || !relayAudioQueue.length) return;

  relayPlaying = true;
  const item = relayAudioQueue.shift();

  try {
    const blob = new Blob([item.arrayBuffer], { type: item.mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = (chorusSettings?.outputVolume ?? 100) / 100;
    audio.playsInline = true;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      relayPlaying = false;
      playNextRelayChunk();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      relayPlaying = false;
      playNextRelayChunk();
    };

    await audio.play();
  } catch (err) {
    relayPlaying = false;
    toast("Tap to enable audio", "Tap anywhere in the call window once so the browser allows audio playback.", "warn", 6000);
    setTimeout(playNextRelayChunk, 300);
  }
}

// Override call starter: send a normal call offer, but don't create WebRTC.
startCall = async function(callType = "audio") {
  if (!activeChatId) return toast("Open a chat first", "Choose a one-on-one DM before calling.", "warn");

  const users = getCallableUsers(activeChatId);
  if (!users.length) return toast("Nobody to call", "Add someone to this DM first.", "warn");

  const currentChat = chats.find(c => Number(c.id) === Number(activeChatId));
  if (currentChat && currentChat.type === "group") {
    return toast("Group calls coming next", "Relay audio calls currently support one-on-one DMs.", "warn", 7000);
  }

  const firstUser = users[0];

  try {
    activeCall.chatId = activeChatId;
    activeCall.peerUserId = firstUser.id;
    activeCall.callType = "relay-audio";

    showCallUI("chorus audio call", "ringing...", firstUser);
    setAudioOnly(true);
    $("incomingCallBox").classList.add("hidden");
    startCallTone();

    // Dummy offer: this powers the existing incoming call popup on the friend's side.
    socket.emit("call:offer", {
      chatId: activeChatId,
      toUserId: firstUser.id,
      offer: { type: "relay-audio", sdp: "chorus-relay-audio" },
      callType: "relay-audio"
    });

    await startRelayVoice(activeChatId, firstUser.id);
  } catch (err) {
    toast("Call cannot start", err.message || "Microphone permission failed.", "error", 9000);
    endCall(false);
  }
};

// Override accept: no WebRTC answer needed, just start relay audio and notify caller.
acceptIncomingCall = async function() {
  stopCallTone();

  const data = activeCall.incomingOffer;
  if (!data) {
    toast("Call is still loading", "Wait one second and tap Accept again.", "warn", 3000);
    return;
  }

  try {
    $("incomingCallBox").classList.add("hidden");
    activeCall.chatId = data.chatId;
    activeCall.peerUserId = data.fromUserId;
    activeCall.callType = "relay-audio";

    socket.emit("call:answer", {
      chatId: data.chatId,
      toUserId: data.fromUserId,
      answer: { type: "relay-audio", sdp: "accepted" }
    });

    await startRelayVoice(data.chatId, data.fromUserId);
  } catch (err) {
    toast("Could not accept call", err.message || "Microphone permission failed.", "error", 9000);
    declineIncomingCall();
  }
};

// Wrap existing endCall so relay audio stops too.
const chorusOldEndCall = endCall;
endCall = function(send = true) {
  stopRelayVoice(send);
  chorusOldEndCall(send);
};

// Extra socket listeners for relay audio.
(function setupRelayAudioSocketPatch() {
  const oldConnectSocket = connectSocket;

  connectSocket = function() {
    oldConnectSocket();

    socket.on("voice:chunk", (data) => {
      if (Number(data.chatId) !== Number(activeCall.chatId)) return;
      if (Number(data.fromUserId) === Number(me.id)) return;
      enqueueRelayAudio(data.chunk, data.mimeType);
    });

    socket.on("voice:joined", (data) => {
      if (Number(data.chatId) !== Number(activeCall.chatId)) return;
      $("callStatus").textContent = "connected";
      $("callQuality").textContent = "relay audio";
    });

    socket.on("voice:left", (data) => {
      if (Number(data.chatId) !== Number(activeCall.chatId)) return;
      toast("Call ended", "The other user left the voice call.", "info", 4000);
      endCall(false);
    });
  };
})();

$("callModal").addEventListener("click", () => {
  playNextRelayChunk();
});


/* ============================================================
   PURE RELAY CALL FLOW FIX
   This disables the broken WebRTC/TURN call flow and uses only
   Socket.IO relayed audio:
   voice:call -> voice:incoming -> voice:accept -> voice:accepted
============================================================ */
let pureRelayIncoming = null;
let pureRelayCallingUser = null;

function resetIncomingButtons() {
  if ($("acceptCallBtn")) {
    $("acceptCallBtn").disabled = false;
    $("acceptCallBtn").textContent = "Accept";
  }
}

async function startPureRelayCall() {
  if (!activeChatId) return toast("Open a DM first", "Choose a one-on-one DM before calling.", "warn");

  const users = getCallableUsers(activeChatId);
  if (!users.length) return toast("Nobody to call", "Add someone to this DM first.", "warn");

  const currentChat = chats.find(c => Number(c.id) === Number(activeChatId));
  if (currentChat && currentChat.type === "group") {
    return toast("Group calls coming next", "Relay audio calls currently support one-on-one DMs.", "warn", 7000);
  }

  const friend = users[0];
  activeCall.chatId = activeChatId;
  activeCall.peerUserId = friend.id;
  activeCall.callType = "relay-audio";
  pureRelayCallingUser = friend;

  showCallUI("chorus audio call", "calling...", friend);
  setAudioOnly(true);
  $("incomingCallBox").classList.add("hidden");
  $("callQuality").textContent = "relay audio";
  startCallTone();

  socket.emit("voice:call", {
    chatId: activeChatId
  });

  toast("Calling", `Calling ${friend.display_name}...`, "info", 3500);
}

async function acceptPureRelayCall() {
  stopCallTone();

  if (!pureRelayIncoming) {
    return toast("No call to accept", "The incoming call was not found. Ask them to call again.", "warn", 4000);
  }

  try {
    const data = pureRelayIncoming;

    activeCall.chatId = data.chatId;
    activeCall.peerUserId = data.fromUserId;
    activeCall.incomingFrom = data.fromUser;
    activeCall.callType = "relay-audio";

    $("incomingCallBox").classList.add("hidden");
    showCallUI("chorus audio call", "connecting...", data.fromUser);
    setAudioOnly(true);
    $("callQuality").textContent = "relay audio";

    socket.emit("voice:accept", {
      chatId: data.chatId,
      toUserId: data.fromUserId
    });

    await startRelayVoice(data.chatId, data.fromUserId);
    $("callStatus").textContent = "connected";
    pureRelayIncoming = null;
  } catch (err) {
    toast("Could not accept call", err.message || "Microphone permission failed.", "error", 9000);
    endCall(false);
  }
}

function declinePureRelayCall() {
  stopCallTone();

  if (pureRelayIncoming) {
    socket.emit("voice:decline", {
      chatId: pureRelayIncoming.chatId,
      toUserId: pureRelayIncoming.fromUserId
    });
  }

  pureRelayIncoming = null;
  $("incomingCallBox").classList.add("hidden");
  $("callModal").classList.add("hidden");
  resetIncomingButtons();
}

// Rebind call buttons to pure relay. This is important because the old
// Accept button was bound to the WebRTC accept function.
if ($("audioCallBtn")) $("audioCallBtn").onclick = () => startPureRelayCall();
if ($("screenShareBtn")) $("screenShareBtn").onclick = () => toast("Screen share disabled", "Audio calls use relay mode. Screen share can be rebuilt later with WebRTC.", "warn", 6000);
if ($("acceptCallBtn")) $("acceptCallBtn").onclick = () => acceptPureRelayCall();
if ($("declineCallBtn")) $("declineCallBtn").onclick = () => declinePureRelayCall();

const pureRelayOldEndCall = endCall;
endCall = function(send = true) {
  stopRelayVoice(send);
  stopCallTone();

  if (send && activeCall.chatId) {
    socket.emit("voice:leave", { chatId: activeCall.chatId });
  }

  pureRelayIncoming = null;
  resetIncomingButtons();
  pureRelayOldEndCall(false);
};

const pureRelayOriginalConnectSocket = connectSocket;
connectSocket = function() {
  pureRelayOriginalConnectSocket();

  socket.on("voice:incoming", (data) => {
    if (relayCallActive || activeCall.chatId || pureRelayIncoming) return;

    pureRelayIncoming = data;
    activeCall.chatId = data.chatId;
    activeCall.peerUserId = data.fromUserId;
    activeCall.incomingFrom = data.fromUser;
    activeCall.callType = "relay-audio";

    startCallTone();
    showCallUI("incoming chorus call", "incoming...", data.fromUser);
    $("incomingCallText").textContent = `${data.fromUser.display_name} is calling you`;
    $("incomingCallBox").classList.remove("hidden");
    resetIncomingButtons();
    setAudioOnly(true);
    $("callQuality").textContent = "relay audio";

    toast("Incoming call", `${data.fromUser.display_name} is calling you.`, "success", 8000);
  });

  socket.on("voice:accepted", async (data) => {
    if (Number(data.chatId) !== Number(activeCall.chatId)) return;

    try {
      stopCallTone();
      $("callStatus").textContent = "connecting...";
      await startRelayVoice(data.chatId, data.fromUserId);
      $("callStatus").textContent = "connected";
      $("callQuality").textContent = "relay audio";
    } catch (err) {
      toast("Call failed", err.message || "Microphone permission failed.", "error", 9000);
      endCall(false);
    }
  });

  socket.on("voice:declined", (data) => {
    if (Number(data.chatId) !== Number(activeCall.chatId)) return;
    toast("Call declined", "They declined your call.", "warn", 4500);
    endCall(false);
  });

  socket.on("voice:chunk", (data) => {
    if (Number(data.chatId) !== Number(activeCall.chatId)) return;
    if (Number(data.fromUserId) === Number(me.id)) return;
    enqueueRelayAudio(data.chunk, data.mimeType);
  });

  socket.on("voice:joined", (data) => {
    if (Number(data.chatId) !== Number(activeCall.chatId)) return;
    $("callStatus").textContent = "connected";
    $("callQuality").textContent = "relay audio";
  });

  socket.on("voice:left", (data) => {
    if (Number(data.chatId) !== Number(activeCall.chatId)) return;
    toast("Call ended", "The other user left the voice call.", "info", 4000);
    endCall(false);
  });
};

// Now start the app only after every call override is installed.
checkSession();
