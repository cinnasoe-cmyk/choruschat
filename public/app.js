
let me = null;
let socket = null;
let chats = [];
let friends = [];
let active = null;
let call = {
  pc: null,
  local: null,
  chatId: null,
  peer: null,
  incoming: null,
  pending: [],
  muted: false
};

let settings = JSON.parse(localStorage.getItem("chorusSettings") || '{"msg":60,"call":100,"mic":"","speaker":""}');

function $(id) { return document.getElementById(id); }

async function api(url, options = {}) {
  const headers = options.headers || {};
  const res = await fetch(url, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...headers }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function saveSettings() {
  localStorage.setItem("chorusSettings", JSON.stringify(settings));
}

function beep() {
  try {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=");
    audio.volume = settings.msg / 100;
    audio.play().catch(() => {});
  } catch {}
}

async function boot() {
  try {
    const data = await api("/api/me");
    me = data.user;
    showApp();
  } catch {
    showAuth();
  }
}

function showAuth() {
  $("auth").classList.remove("hide");
  $("app").classList.add("hide");
}

function showApp() {
  $("auth").classList.add("hide");
  $("app").classList.remove("hide");
  renderMe();
  connectSocket();
  refreshFriends();
  refreshChats();
  loadDevices();
}

function renderMe() {
  $("selfPic").src = me.avatar;
  $("profilePic").src = me.avatar;
  $("selfName").textContent = me.display_name;
  $("selfUser").textContent = "@" + me.username;
  $("displayName").value = me.display_name;
  $("bio").value = me.bio || "";
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ withCredentials: true });

  socket.on("friends:update", refreshFriends);
  socket.on("chats:update", refreshChats);

  socket.on("message:new", msg => {
    if (active && Number(msg.chat_id) === Number(active.id)) addMessage(msg);
    else beep();
    refreshChats();
  });

  socket.on("message:update", updateMessage);

  socket.on("messages:cleared", data => {
    if (active && Number(data.chatId) === Number(active.id)) {
      $("messages").innerHTML = "";
    }
  });

  wireCallSocket();
}

async function refreshFriends() {
  const data = await api("/api/friends");
  friends = data.friends;

  $("friendList").innerHTML = friends.map(userRow).join("");

  $("requests").innerHTML = data.incoming.map(req => `
    <div class="request">
      <b>${esc(req.display_name)}</b>
      <small>@${esc(req.username)}</small>
      <button onclick="friendRespond(${req.request_id}, 'accept')">Accept</button>
      <button onclick="friendRespond(${req.request_id}, 'decline')">Decline</button>
    </div>
  `).join("");

  renderGroupFriends();
}

async function refreshChats() {
  const data = await api("/api/chats");
  chats = data.chats;

  $("chatList").innerHTML = chats.map(chat => `
    <button class="row ${active && active.id === chat.id ? "active" : ""}" onclick="openChat(${chat.id})">
      <img src="${chat.avatar}">
      <div>
        <b>${esc(chat.title)}</b>
        <small>${esc(chat.last ? chat.last.body : "No messages yet")}</small>
      </div>
    </button>
  `).join("");
}

function userRow(user) {
  return `
    <button class="row" onclick="openDM(${user.id})">
      <img src="${user.avatar}">
      <div>
        <b>${esc(user.display_name)}</b>
        <small>@${esc(user.username)}</small>
      </div>
    </button>
  `;
}

function openDM(id) {
  const chat = chats.find(item => {
    return item.type === "dm" && item.members.some(member => member.id === id);
  });

  if (!chat) {
    toast("DM opens after the friend request is accepted.");
    return;
  }

  openChat(chat.id);
}

async function openChat(id) {
  active = chats.find(chat => chat.id === id);
  if (!active) return;

  $("side").classList.remove("open");
  $("chatTitle").textContent = active.title;
  $("chatPic").src = active.avatar;
  $("chatSub").textContent = active.members.map(m => m.display_name).join(", ");

  await refreshMessages();
  refreshChats();
}

async function refreshMessages() {
  const data = await api(`/api/chats/${active.id}/messages`);
  $("messages").innerHTML = "";
  data.messages.forEach(addMessage);
  scrollEnd();
}

function addMessage(msg) {
  const el = document.createElement("div");
  el.className = "msg";
  el.id = "msg-" + msg.id;
  el.innerHTML = messageHTML(msg);
  $("messages").appendChild(el);
  scrollEnd();
}

function updateMessage(msg) {
  const el = $("msg-" + msg.id);
  if (el) el.innerHTML = messageHTML(msg);
}

function messageHTML(msg) {
  const isMine = msg.sender_id === me.id;
  const controls = isMine
    ? `<button onclick="editMsg(${msg.id})">edit</button><button onclick="deleteMsg(${msg.id})">delete</button>`
    : "";

  const reactions = (msg.reactions || []).map(reaction => {
    return `<button onclick="react(${msg.id}, '${reaction.emoji}')">${reaction.emoji} ${reaction.count}</button>`;
  }).join("");

  return `
    <img src="${msg.avatar}">
    <div class="bubble">
      <div>
        <b>${esc(msg.display_name)}</b>
        <small>${new Date(msg.created_at).toLocaleString()}${msg.edited ? " · edited" : ""}</small>
      </div>
      <p>${esc(msg.body)}</p>
      <div class="reacts">
        ${reactions}
        <button onclick="react(${msg.id}, '😭')">😭</button>
        <button onclick="react(${msg.id}, '❤️')">❤️</button>
        ${controls}
      </div>
    </div>
  `;
}

function scrollEnd() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

function react(id, emoji) {
  socket.emit("message:react", { id, emoji });
}

function editMsg(id) {
  const old = $("msg-" + id).querySelector("p").textContent;
  const body = prompt("Edit message", old);
  if (body) socket.emit("message:edit", { id, body });
}

function deleteMsg(id) {
  if (confirm("Delete this message?")) socket.emit("message:delete", { id });
}

async function friendRespond(id, action) {
  await api("/api/friends/respond", {
    method: "POST",
    body: JSON.stringify({ requestId: id, action })
  });
  refreshFriends();
  refreshChats();
}

function renderGroupFriends() {
  const box = $("groupFriends");
  if (!box) return;
  box.innerHTML = friends.map(friend => {
    return `<label><input type="checkbox" value="${friend.id}"> ${esc(friend.display_name)}</label>`;
  }).join("");
}

$("showLogin").onclick = () => {
  $("loginForm").classList.remove("hide");
  $("regForm").classList.add("hide");
  $("showLogin").classList.add("on");
  $("showReg").classList.remove("on");
};

$("showReg").onclick = () => {
  $("regForm").classList.remove("hide");
  $("loginForm").classList.add("hide");
  $("showReg").classList.add("on");
  $("showLogin").classList.remove("on");
};

$("loginForm").onsubmit = async event => {
  event.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("loginUser").value,
        password: $("loginPass").value
      })
    });
    me = data.user;
    showApp();
  } catch (err) {
    $("authErr").textContent = err.message;
  }
};

$("regForm").onsubmit = async event => {
  event.preventDefault();
  try {
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("regUser").value,
        displayName: $("regDisplay").value,
        password: $("regPass").value
      })
    });
    me = data.user;
    showApp();
  } catch (err) {
    $("authErr").textContent = err.message;
  }
};

$("composer").onsubmit = event => {
  event.preventDefault();
  if (!active) return toast("Open a chat first.");
  const body = $("msgInput").value.trim();
  if (!body) return;
  socket.emit("message:send", { chatId: active.id, body });
  $("msgInput").value = "";
};

$("addFriend").onclick = async () => {
  try {
    await api("/api/friends/request", {
      method: "POST",
      body: JSON.stringify({ username: $("friendUser").value })
    });
    $("friendUser").value = "";
    toast("Friend request sent.");
  } catch (err) {
    toast(err.message);
  }
};

$("clearBtn").onclick = async () => {
  if (!active) return;
  if (confirm("Clear this chat?")) {
    await api(`/api/chats/${active.id}/messages`, { method: "DELETE" });
  }
};

$("self").onclick = () => openModal("profile");
$("settingsBtn").onclick = () => openModal("settings");
$("newGroup").onclick = () => openModal("group");
document.querySelectorAll(".x").forEach(btn => {
  btn.onclick = () => btn.closest(".modal").classList.add("hide");
});

function openModal(id) {
  $(id).classList.remove("hide");
}

$("logout").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};

$("saveProfile").onclick = async () => {
  try {
    const data = await api("/api/me", {
      method: "PUT",
      body: JSON.stringify({
        displayName: $("displayName").value,
        bio: $("bio").value
      })
    });
    me = data.user;
    renderMe();
    toast("Profile saved.");
  } catch (err) {
    toast(err.message);
  }
};

$("avatarFile").onchange = async () => {
  const form = new FormData();
  form.append("avatar", $("avatarFile").files[0]);
  const res = await fetch("/api/me/avatar", {
    method: "POST",
    credentials: "include",
    body: form
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || "Upload failed");
  me = data.user;
  renderMe();
  toast("Avatar updated.");
};

$("createGroup").onclick = async () => {
  const ids = Array.from(document.querySelectorAll("#groupFriends input:checked")).map(input => Number(input.value));
  await api("/api/chats/group", {
    method: "POST",
    body: JSON.stringify({ name: $("groupName").value, userIds: ids })
  });
  $("group").classList.add("hide");
  refreshChats();
};

$("mobileMenu").onclick = () => $("side").classList.toggle("open");
$("mobileBack").onclick = () => $("side").classList.toggle("open");

$("msgVol").value = settings.msg;
$("callVol").value = settings.call;
$("msgVol").oninput = event => {
  settings.msg = Number(event.target.value);
  saveSettings();
};
$("callVol").oninput = event => {
  settings.call = Number(event.target.value);
  saveSettings();
  $("remoteAudio").volume = settings.call / 100;
};

async function loadDevices() {
  try {
    const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
    temp.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(device => device.kind === "audioinput");
    const speakers = devices.filter(device => device.kind === "audiooutput");

    $("mic").innerHTML = `<option value="">Default</option>` + mics.map(device => {
      return `<option value="${device.deviceId}">${esc(device.label || "Microphone")}</option>`;
    }).join("");

    $("speaker").innerHTML = `<option value="">Default</option>` + speakers.map(device => {
      return `<option value="${device.deviceId}">${esc(device.label || "Speaker")}</option>`;
    }).join("");

    $("mic").value = settings.mic || "";
    $("speaker").value = settings.speaker || "";
  } catch {}
}

$("refreshDevices").onclick = loadDevices;
$("mic").onchange = event => {
  settings.mic = event.target.value;
  saveSettings();
};
$("speaker").onchange = event => {
  settings.speaker = event.target.value;
  saveSettings();
};

async function iceConfig() {
  const data = await api("/api/ice");
  return { iceServers: data.iceServers, iceCandidatePoolSize: 10 };
}

async function getMicStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: settings.mic ? { exact: settings.mic } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
}

async function createPeer(peerId) {
  const pc = new RTCPeerConnection(await iceConfig());
  call.pc = pc;

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("call:ice", {
        chatId: call.chatId,
        targetId: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    const audio = $("remoteAudio");
    audio.srcObject = event.streams[0];
    audio.volume = settings.call / 100;

    if (audio.setSinkId && settings.speaker) {
      audio.setSinkId(settings.speaker).catch(() => {});
    }

    audio.play().catch(() => toast("Tap the call window to enable audio."));
    $("callStatus").textContent = "connected";
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === "connected") $("callStatus").textContent = "connected";
    if (state === "failed" || state === "disconnected") $("callStatus").textContent = state;
  };

  return pc;
}

async function startLocalAudio() {
  call.local = await getMicStream();
  call.local.getTracks().forEach(track => call.pc.addTrack(track, call.local));
}

function showCall(title, status, user, incoming = false) {
  $("call").classList.remove("hide");
  $("incoming").classList.toggle("hide", !incoming);
  $("callTitle").textContent = title;
  $("callStatus").textContent = status;
  $("callPic").src = user ? user.avatar : "/default-avatar.svg";
}

function resetCall(send = true) {
  if (send && call.peer && call.chatId) {
    socket.emit("call:end", { chatId: call.chatId, targetId: call.peer });
  }

  try { if (call.pc) call.pc.close(); } catch {}
  if (call.local) call.local.getTracks().forEach(track => track.stop());

  call = {
    pc: null,
    local: null,
    chatId: null,
    peer: null,
    incoming: null,
    pending: [],
    muted: false
  };

  $("call").classList.add("hide");
  $("incoming").classList.add("hide");
}

$("callBtn").onclick = () => {
  if (!active) return toast("Open a DM first.");
  if (active.type !== "dm") return toast("Calls are one-on-one for now.");

  const other = active.members.find(member => member.id !== me.id);
  if (!other) return;

  call.chatId = active.id;
  call.peer = other.id;
  showCall("Calling " + other.display_name, "ringing", other, false);
  socket.emit("call:invite", { chatId: active.id, targetId: other.id });
};

$("accept").onclick = () => {
  const incoming = call.incoming;
  if (!incoming) return;

  socket.emit("call:accept", {
    chatId: incoming.chatId,
    targetId: incoming.from.id
  });

  $("incoming").classList.add("hide");
  $("callStatus").textContent = "connecting";
};

$("decline").onclick = () => {
  if (call.incoming) {
    socket.emit("call:decline", {
      chatId: call.incoming.chatId,
      targetId: call.incoming.from.id
    });
  }
  resetCall(false);
};

$("endCall").onclick = () => resetCall(true);

$("mute").onclick = () => {
  call.muted = !call.muted;
  if (call.local) call.local.getAudioTracks().forEach(track => track.enabled = !call.muted);
  $("mute").textContent = call.muted ? "Unmute" : "Mute";
};

$("call").onclick = () => $("remoteAudio").play().catch(() => {});

function wireCallSocket() {
  socket.on("call:incoming", data => {
    call.chatId = data.chatId;
    call.peer = data.from.id;
    call.incoming = data;
    showCall("Incoming call", "incoming", data.from, true);
  });

  socket.on("call:accepted", async data => {
    try {
      $("callStatus").textContent = "connecting";
      call.peer = data.from.id;
      call.pc = await createPeer(data.from.id);
      await startLocalAudio();
      const offer = await call.pc.createOffer();
      await call.pc.setLocalDescription(offer);
      socket.emit("call:offer", {
        chatId: data.chatId,
        targetId: data.from.id,
        offer
      });
    } catch (err) {
      toast(err.message);
      resetCall(true);
    }
  });

  socket.on("call:offer", async data => {
    try {
      call.chatId = data.chatId;
      call.peer = data.fromUserId;
      call.pc = await createPeer(data.fromUserId);
      await startLocalAudio();
      await call.pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      for (const candidate of call.pending) {
        await call.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      call.pending = [];

      const answer = await call.pc.createAnswer();
      await call.pc.setLocalDescription(answer);

      socket.emit("call:answer", {
        chatId: data.chatId,
        targetId: data.fromUserId,
        answer
      });

      $("callStatus").textContent = "connecting";
    } catch (err) {
      toast(err.message);
      resetCall(true);
    }
  });

  socket.on("call:answer", async data => {
    try {
      await call.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      for (const candidate of call.pending) {
        await call.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      call.pending = [];
      $("callStatus").textContent = "connecting";
    } catch (err) {
      toast(err.message);
    }
  });

  socket.on("call:ice", async data => {
    try {
      if (call.pc && call.pc.remoteDescription) {
        await call.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        call.pending.push(data.candidate);
      }
    } catch (err) {
      console.warn(err);
    }
  });

  socket.on("call:declined", () => {
    toast("Call declined.");
    resetCall(false);
  });

  socket.on("call:end", () => {
    toast("Call ended.");
    resetCall(false);
  });
}

boot();
