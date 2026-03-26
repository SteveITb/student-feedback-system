const express  = require("express");
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const path     = require("path");

const app        = express();
const PORT       = process.env.PORT       || 3000;
const MONGO_URI  = process.env.MONGO_URI  || "mongodb://localhost:27017/student_feedback";
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_production";

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅  MongoDB connected:", MONGO_URI))
  .catch(err => console.error("❌  MongoDB error:", err.message));

const isConnected = () => mongoose.connection.readyState === 1;

// ── Schemas ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  admissionNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:        { type: String, required: true },
  role:            { type: String, enum: ["student", "admin"], default: "student" }
}, { timestamps: true });

const feedbackSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, maxlength: 100 },
  course:      { type: String, required: true, trim: true, maxlength: 150 },
  rating:      { type: String, required: true },
  comments:    { type: String, trim: true, maxlength: 1000, default: "" },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const User     = mongoose.model("User",     userSchema);
const Feedback = mongoose.model("Feedback", feedbackSchema);

// In-memory fallback
let inMemoryUsers     = [];
let inMemoryFeedbacks = [];

// ── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer "))
    return res.status(401).json({ message: "No token provided." });
  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Admins only." });
  next();
}

// ── Auth Routes ───────────────────────────────────────────────────────────────

// Register
app.post("/auth/register", async (req, res) => {
  const { name, admissionNumber, email, password } = req.body;
  if (!name || !admissionNumber || !email || !password)
    return res.status(400).json({ message: "All fields are required." });
  if (password.length < 6)
    return res.status(400).json({ message: "Password must be at least 6 characters." });

  try {
    const hashed = await bcrypt.hash(password, 10);
    let user;

    if (isConnected()) {
      const existsAdm   = await User.findOne({ admissionNumber: admissionNumber.toUpperCase() });
      if (existsAdm) return res.status(409).json({ message: "Admission number already registered." });
      const existsEmail = await User.findOne({ email: email.toLowerCase() });
      if (existsEmail) return res.status(409).json({ message: "Email already registered." });
      user = await User.create({ name, admissionNumber: admissionNumber.toUpperCase(), email, password: hashed });
    } else {
      const existsAdm = inMemoryUsers.find(u => u.admissionNumber === admissionNumber.toUpperCase());
      if (existsAdm) return res.status(409).json({ message: "Admission number already registered." });
      const existsEmail = inMemoryUsers.find(u => u.email === email.toLowerCase());
      if (existsEmail) return res.status(409).json({ message: "Email already registered." });
      user = { _id: Date.now().toString(), name, admissionNumber: admissionNumber.toUpperCase(), email: email.toLowerCase(), password: hashed, role: "student" };
      inMemoryUsers.push(user);
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, admissionNumber: user.admissionNumber, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: "7d" }
    );
    res.status(201).json({ token, user: { id: user._id, name: user.name, admissionNumber: user.admissionNumber, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed." });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { admissionNumber, password } = req.body;
  if (!admissionNumber || !password)
    return res.status(400).json({ message: "Admission number and password are required." });

  try {
    let user;
    if (isConnected()) {
      user = await User.findOne({ admissionNumber: admissionNumber.toUpperCase() }).lean();
    } else {
      user = inMemoryUsers.find(u => u.admissionNumber === admissionNumber.toUpperCase());
    }

    if (!user) return res.status(401).json({ message: "Invalid admission number or password." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid admission number or password." });

    const token = jwt.sign(
      { id: user._id, name: user.name, admissionNumber: user.admissionNumber, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user._id, name: user.name, admissionNumber: user.admissionNumber, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed." });
  }
});

// ── Feedback Routes ───────────────────────────────────────────────────────────

app.post("/submit", authMiddleware, async (req, res) => {
  const { name, course, rating, comments, submittedAt } = req.body;
  if (!name || !course || !rating)
    return res.status(400).json({ success: false, message: "Name, course and rating are required." });

  const payload = {
    name: name.trim(), course: course.trim(), rating,
    comments: (comments || "").trim(),
    submittedBy: req.user.id,
    submittedAt: submittedAt || new Date().toISOString()
  };

  try {
    if (isConnected()) {
      const doc = await Feedback.create(payload);
      return res.status(201).json({ success: true, id: doc._id });
    }
    payload._id = Date.now().toString();
    inMemoryFeedbacks.push(payload);
    return res.status(201).json({ success: true, id: payload._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Could not save feedback." });
  }
});

app.get("/feedbacks", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (isConnected()) {
      const feedbacks = await Feedback.find().sort({ createdAt: -1 }).lean();
      return res.json(feedbacks);
    }
    return res.json(inMemoryFeedbacks.slice().reverse());
  } catch (err) {
    res.status(500).json({ message: "Could not retrieve feedback." });
  }
});

app.delete("/feedbacks/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (isConnected()) await Feedback.findByIdAndDelete(req.params.id);
    else inMemoryFeedbacks = inMemoryFeedbacks.filter(f => f._id !== req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Could not delete feedback." });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", db: isConnected() ? "mongodb" : "in-memory", uptime: process.uptime() });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/view.html",  (req, res) => res.sendFile(path.join(__dirname, "public", "view.html")));
app.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.listen(PORT, () => console.log(`🚀  Server running at http://localhost:${PORT}`));
