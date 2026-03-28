const express    = require("express");
const mongoose   = require("mongoose");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path       = require("path");

const app        = express();
const PORT       = process.env.PORT        || 3000;
const MONGO_URI  = process.env.MONGO_URI   || "mongodb://localhost:27017/student_feedback";
const JWT_SECRET = process.env.JWT_SECRET  || "change_this_secret_in_production";
const EMAIL_USER = process.env.EMAIL_USER  || "";   // your Gmail address
const EMAIL_PASS = process.env.EMAIL_PASS  || "";   // your Gmail App Password

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅  MongoDB connected"))
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

let inMemoryUsers     = [];
let inMemoryFeedbacks = [];

// ── Email Transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

function getRatingLabel(rating) {
  const map = { "5": "Excellent ★★★★★", "4": "Good ★★★★", "3": "Average ★★★", "2": "Poor ★★", "1": "Very Poor ★" };
  return map[String(rating)] || rating;
}

function sendFeedbackConfirmation({ toName, toEmail, course, rating, comments }) {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn("⚠️  Email not configured — skipping confirmation email.");
    return;
  }

  const ratingLabel = getRatingLabel(rating);
  const date = new Date().toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Feedback Received</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f0f4f8; font-family: 'Segoe UI', Arial, sans-serif; padding: 40px 16px; }
    .wrapper { max-width: 580px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0a1628 0%, #0d2147 100%);
      border-radius: 16px 16px 0 0;
      padding: 36px 40px;
      text-align: center;
    }
    .header .logo-text {
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 1px;
    }
    .header .logo-text span { color: #6c8fff; }
    .header p {
      color: rgba(255,255,255,0.6);
      font-size: 13px;
      margin-top: 6px;
      letter-spacing: 0.5px;
    }
    .body {
      background: #ffffff;
      padding: 40px;
    }
    .greeting {
      font-size: 22px;
      font-weight: 700;
      color: #0d2147;
      margin-bottom: 16px;
    }
    .greeting span { color: #6c8fff; }
    .message {
      color: #4b5563;
      font-size: 15px;
      line-height: 1.8;
      margin-bottom: 28px;
    }
    .summary-card {
      background: #f8faff;
      border: 1px solid #e0e7ff;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 28px;
    }
    .summary-card h3 {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #6c8fff;
      margin-bottom: 16px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
    }
    .summary-row:last-child { border-bottom: none; }
    .summary-row .label { color: #6b7280; font-weight: 500; flex-shrink: 0; margin-right: 16px; }
    .summary-row .value { color: #111827; font-weight: 500; text-align: right; }
    .commitment {
      background: linear-gradient(135deg, #f0f4ff, #f5f0ff);
      border-left: 4px solid #6c8fff;
      border-radius: 0 12px 12px 0;
      padding: 20px 24px;
      margin-bottom: 28px;
      color: #374151;
      font-size: 14px;
      line-height: 1.8;
      font-style: italic;
    }
    .divider { height: 1px; background: #e9ecef; margin: 24px 0; }
    .cta {
      text-align: center;
      margin-bottom: 28px;
    }
    .cta a {
      display: inline-block;
      background: linear-gradient(135deg, #6c8fff, #a78bfa);
      color: #fff;
      text-decoration: none;
      padding: 13px 32px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .footer {
      background: #0a1628;
      border-radius: 0 0 16px 16px;
      padding: 28px 40px;
      text-align: center;
    }
    .footer p { color: rgba(255,255,255,0.4); font-size: 12px; line-height: 1.8; }
    .footer a { color: #6c8fff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo-text">ZETECH <span>UNIVERSITY</span></div>
      <p>Student Feedback Portal</p>
    </div>

    <div class="body">
      <div class="greeting">Dear <span>${toName}</span>,</div>

      <p class="message">
        Thank you for taking the time to share your feedback with us. Your voice matters greatly to Zetech University, 
        and we are committed to using your input to continuously improve the quality of our programmes, 
        teaching, and overall student experience.
      </p>

      <div class="summary-card">
        <h3>Your Feedback Summary</h3>
        <div class="summary-row">
          <span class="label">Course</span>
          <span class="value">${course}</span>
        </div>
        <div class="summary-row">
          <span class="label">Rating</span>
          <span class="value">${ratingLabel}</span>
        </div>
        <div class="summary-row">
          <span class="label">Comments</span>
          <span class="value">${comments || "No additional comments provided."}</span>
        </div>
        <div class="summary-row">
          <span class="label">Submitted On</span>
          <span class="value">${date}</span>
        </div>
      </div>

      <div class="commitment">
        "At Zetech University, we believe that every student's experience shapes the future of our institution. 
        Your feedback has been received and will be reviewed by the relevant academic team. 
        We are dedicated to transforming your insights into meaningful improvements."
      </div>

      <div class="divider"></div>

      <div class="cta">
        <a href="https://student-feedback-system-bymi.onrender.com">Submit Another Response</a>
      </div>

      <p style="color:#6b7280;font-size:13px;line-height:1.7;text-align:center;">
        If you have any further concerns or queries, please do not hesitate to contact 
        the Student Affairs Office at Zetech University. We are always here to support you.
      </p>
    </div>

    <div class="footer">
      <p>
        &copy; ${new Date().getFullYear()} Zetech University &bull; Student Feedback Portal<br/>
        This is an automated message — please do not reply to this email.<br/>
        <a href="https://zetech.ac.ke">zetech.ac.ke</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  transporter.sendMail({
    from:    `"Zetech University" <${EMAIL_USER}>`,
    to:      toEmail,
    subject: `✅ Feedback Received — ${course} | Zetech University`,
    html
  }, (err, info) => {
    if (err) console.error("❌  Email send error:", err.message);
    else     console.log("📧  Confirmation email sent to:", toEmail, info.messageId);
  });
}

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
      if (await User.findOne({ admissionNumber: admissionNumber.toUpperCase() }))
        return res.status(409).json({ message: "Admission number already registered." });
      if (await User.findOne({ email: email.toLowerCase() }))
        return res.status(409).json({ message: "Email already registered." });
      user = await User.create({ name, admissionNumber: admissionNumber.toUpperCase(), email, password: hashed });
    } else {
      if (inMemoryUsers.find(u => u.admissionNumber === admissionNumber.toUpperCase()))
        return res.status(409).json({ message: "Admission number already registered." });
      if (inMemoryUsers.find(u => u.email === email.toLowerCase()))
        return res.status(409).json({ message: "Email already registered." });
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

app.post("/auth/login", async (req, res) => {
  const { admissionNumber, password } = req.body;
  if (!admissionNumber || !password)
    return res.status(400).json({ message: "Admission number and password are required." });
  try {
    const user = isConnected()
      ? await User.findOne({ admissionNumber: admissionNumber.toUpperCase() }).lean()
      : inMemoryUsers.find(u => u.admissionNumber === admissionNumber.toUpperCase());
    if (!user) return res.status(401).json({ message: "Invalid admission number or password." });
    if (!await bcrypt.compare(password, user.password))
      return res.status(401).json({ message: "Invalid admission number or password." });
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
      // Send confirmation email using the email stored in JWT
      sendFeedbackConfirmation({
        toName:   req.user.name,
        toEmail:  req.user.email,
        course:   payload.course,
        rating:   payload.rating,
        comments: payload.comments
      });
      return res.status(201).json({ success: true, id: doc._id });
    }
    payload._id = Date.now().toString();
    inMemoryFeedbacks.push(payload);
    sendFeedbackConfirmation({
      toName:   req.user.name,
      toEmail:  req.user.email,
      course:   payload.course,
      rating:   payload.rating,
      comments: payload.comments
    });
    return res.status(201).json({ success: true, id: payload._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Could not save feedback." });
  }
});

app.get("/feedbacks", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const feedbacks = isConnected()
      ? await Feedback.find().sort({ createdAt: -1 }).lean()
      : inMemoryFeedbacks.slice().reverse();
    res.json(feedbacks);
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
  res.json({ status: "ok", db: isConnected() ? "mongodb" : "in-memory", email: EMAIL_USER ? "configured" : "not configured", uptime: process.uptime() });
});

app.get("/",           (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/view.html",  (req, res) => res.sendFile(path.join(__dirname, "public", "view.html")));
app.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.listen(PORT, () => console.log(`🚀  Server running at http://localhost:${PORT}`));
