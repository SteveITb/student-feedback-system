const form      = document.getElementById("feedbackForm");
const submitBtn = document.getElementById("submitBtn");
const toast     = document.getElementById("toast");
const toastMsg  = document.getElementById("toastMsg");
const toastIcon = document.getElementById("toastIcon");

let toastTimer;

// ── Auto-logout settings ──────────────────────────────────────────────────────
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes of inactivity
let inactivityTimer;
let warningTimer;
let warningShown = false;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  if (warningShown) hideWarning();

  // Show warning 1 minute before logout
  warningTimer = setTimeout(() => {
    showInactivityWarning();
  }, INACTIVITY_TIMEOUT - 60000);

  // Auto logout after timeout
  inactivityTimer = setTimeout(() => {
    autoLogout("You have been logged out due to inactivity.");
  }, INACTIVITY_TIMEOUT);
}

function autoLogout(reason) {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.setItem("logoutReason", reason);
  window.location.href = "/login.html";
}

// Show warning banner
function showInactivityWarning() {
  warningShown = true;
  let existing = document.getElementById("inactivityWarning");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "inactivityWarning";
  banner.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.4);
    backdrop-filter:blur(16px); border-radius:14px;
    padding:14px 24px; z-index:300; display:flex; align-items:center; gap:14px;
    font-family:Inter,sans-serif; font-size:13px; color:#fbbf24;
    box-shadow:0 8px 32px rgba(0,0,0,0.4); max-width:420px; width:90%;
    animation: slideUp 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
  `;

  let secs = 60;
  banner.innerHTML = `
    <span style="font-size:20px">⚠️</span>
    <div style="flex:1">
      <strong style="display:block;margin-bottom:2px">Session expiring soon</strong>
      <span id="warningCountdown">You will be logged out in 60 seconds due to inactivity.</span>
    </div>
    <button onclick="resetInactivityTimer()" style="
      background:linear-gradient(135deg,#2d5be3,#7c3aed); color:#fff;
      border:none; border-radius:8px; padding:7px 14px;
      font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;
    ">Stay Logged In</button>
  `;

  const style = document.createElement("style");
  style.textContent = "@keyframes slideUp{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}";
  document.head.appendChild(style);
  document.body.appendChild(banner);

  // Countdown
  const countInterval = setInterval(() => {
    secs--;
    const el = document.getElementById("warningCountdown");
    if (el) el.textContent = `You will be logged out in ${secs} second${secs !== 1 ? "s" : ""} due to inactivity.`;
    if (secs <= 0) clearInterval(countInterval);
  }, 1000);
}

function hideWarning() {
  warningShown = false;
  const el = document.getElementById("inactivityWarning");
  if (el) el.remove();
}

// Listen for user activity
["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// Start the inactivity timer
resetInactivityTimer();

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  toastMsg.textContent = message;
  toastIcon.textContent = type === "success" ? "✓" : "✕";
  toast.className = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function getStarRating() {
  const checked = document.querySelector('input[name="stars"]:checked');
  return checked ? checked.value : null;
}

function validateForm(data) {
  if (!data.name.trim())   return "Please enter your name.";
  if (!data.course.trim()) return "Please enter the course name.";
  if (!data.rating)        return "Please select a star rating.";
  return null;
}

function clearErrors() {
  document.querySelectorAll(".field-error").forEach(el => el.remove());
}

function showFieldError(inputId, message) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const err = document.createElement("div");
  err.className = "field-error";
  err.style.cssText = "color:#f87171;font-size:12px;margin-top:-10px;margin-bottom:10px;";
  err.textContent = message;
  el.parentNode.insertBefore(err, el.nextSibling);
}

// ── Form submit ───────────────────────────────────────────────────────────────
form.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearErrors();

  const data = {
    name:        document.getElementById("name").value.trim(),
    course:      document.getElementById("course").value.trim(),
    rating:      getStarRating(),
    comments:    document.getElementById("comments").value.trim(),
    submittedAt: new Date().toISOString()
  };

  const error = validateForm(data);
  if (error) {
    showToast(error, "error");
    if (!data.name)   showFieldError("name",   "Name is required");
    if (!data.course) showFieldError("course", "Course is required");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");

  try {
    const token = localStorage.getItem("token");
    const res = await fetch("/submit", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": "Bearer " + token } : {})
      },
      body: JSON.stringify(data)
    });

    if (res.status === 401) {
      autoLogout("Session expired. Please log in again.");
      return;
    }

    if (!res.ok) throw new Error("Server error");

    // Show success toast
    showToast("Feedback submitted! Logging you out for security…", "success");

    // Reset form
    form.reset();
    document.querySelectorAll('input[name="stars"]').forEach(r => r.checked = false);

    // Auto-logout after 3 seconds for security
    setTimeout(() => {
      autoLogout("Thank you! You have been logged out after submitting your feedback.");
    }, 3000);

  } catch (err) {
    showToast("Something went wrong. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
});
