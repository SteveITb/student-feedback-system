const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/student_feedback";

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── MongoDB Schema ───────────────────────────────────────────────────────────
const feedbackSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, maxlength: 100 },
    course:      { type: String, required: true, trim: true, maxlength: 150 },
    rating:      { type: String, required: true, enum: ["1","2","3","4","5","Excellent","Good","Average","Poor","Very Poor"] },
    comments:    { type: String, trim: true, maxlength: 1000, default: "" },
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);

// ── Connect to MongoDB ───────────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅  MongoDB connected:", MONGO_URI))
  .catch((err) => {
    console.error("❌  MongoDB connection failed:", err.message);
    console.warn("⚠️   Falling back to in-memory store");
  });

// ── In-memory fallback (used when MongoDB is not connected) ──────────────────
let inMemory = [];
const isConnected = () => mongoose.connection.readyState === 1;

// ── Helper: validate incoming feedback ──────────────────────────────────────
function validateFeedback(body) {
  const { name, course, rating } = body;
  if (!name || typeof name !== "string" || name.trim().length === 0)
    return "Name is required.";
  if (!course || typeof course !== "string" || course.trim().length === 0)
    return "Course is required.";
  if (!rating)
    return "Rating is required.";
  return null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Submit feedback
app.post("/submit", async (req, res) => {
  const error = validateFeedback(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const payload = {
    name:        req.body.name.trim(),
    course:      req.body.course.trim(),
    rating:      req.body.rating,
    comments:    (req.body.comments || "").trim(),
    submittedAt: req.body.submittedAt || new Date().toISOString()
  };

  try {
    if (isConnected()) {
      const doc = await Feedback.create(payload);
      return res.status(201).json({ success: true, id: doc._id });
    } else {
      payload._id = Date.now().toString();
      inMemory.push(payload);
      return res.status(201).json({ success: true, id: payload._id });
    }
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ success: false, message: "Could not save feedback." });
  }
});

// Get all feedbacks
app.get("/feedbacks", async (req, res) => {
  try {
    if (isConnected()) {
      const feedbacks = await Feedback.find().sort({ createdAt: -1 }).lean();
      return res.json(feedbacks);
    } else {
      return res.json(inMemory.slice().reverse());
    }
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ success: false, message: "Could not retrieve feedback." });
  }
});

// Delete a feedback entry
app.delete("/feedbacks/:id", async (req, res) => {
  try {
    if (isConnected()) {
      await Feedback.findByIdAndDelete(req.params.id);
    } else {
      inMemory = inMemory.filter(f => f._id !== req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false, message: "Could not delete feedback." });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    db: isConnected() ? "mongodb" : "in-memory",
    uptime: process.uptime()
  });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  Server running at http://localhost:${PORT}`);
});
