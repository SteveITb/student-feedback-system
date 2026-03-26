const form = document.getElementById("feedbackForm");
const submitBtn = document.getElementById("submitBtn");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");
const toastIcon = document.getElementById("toastIcon");

let toastTimer;

function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  toastMsg.textContent = message;
  toastIcon.textContent = type === "success" ? "✓" : "✕";
  toast.className = `toast ${type}`;
  // Force reflow so transition replays
  void toast.offsetWidth;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function getStarRating() {
  const checked = document.querySelector('input[name="stars"]:checked');
  return checked ? checked.value : null;
}

function validateForm(data) {
  if (!data.name.trim()) return "Please enter your name.";
  if (!data.course.trim()) return "Please enter the course name.";
  if (!data.rating) return "Please select a star rating.";
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

form.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearErrors();

  const data = {
    name: document.getElementById("name").value.trim(),
    course: document.getElementById("course").value.trim(),
    rating: getStarRating(),
    comments: document.getElementById("comments").value.trim(),
    submittedAt: new Date().toISOString()
  };

  const error = validateForm(data);
  if (error) {
    showToast(error, "error");
    if (!data.name) showFieldError("name", "Name is required");
    if (!data.course) showFieldError("course", "Course is required");
    return;
  }

  // Loading state
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");

  try {
    const res = await fetch("/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error("Server error");

    showToast("Feedback submitted successfully!", "success");
    form.reset();
    // Uncheck stars visually
    document.querySelectorAll('input[name="stars"]').forEach(r => r.checked = false);

  } catch (err) {
    showToast("Something went wrong. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
});
