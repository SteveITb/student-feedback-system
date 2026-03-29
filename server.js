const express    = require("express");
const mongoose   = require("mongoose");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path       = require("path");
const crypto     = require("crypto");
const cron       = require("node-cron");
const app        = express();
const PORT       = process.env.PORT        || 3000;
const MONGO_URI  = process.env.MONGO_URI   || "mongodb://localhost:27017/student_feedback";
const JWT_SECRET = process.env.JWT_SECRET  || "change_this_secret_in_production";
const EMAIL_USER = process.env.EMAIL_USER  || "";   // your Gmail address
const EMAIL_PASS = process.env.EMAIL_PASS  || "";   // your Gmail App Password
const APP_URL    = process.env.APP_URL     || "http://localhost:3000";

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
  role:            { type: String, enum: ["student", "admin"], default: "student" },
  resetToken:      { type: String },
  resetTokenExpiry: { type: Date }
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


// Forgot Password
app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required." });

  try {
    let user;
    if (isConnected()) {
      user = await User.findOne({ email: email.toLowerCase() });
    } else {
      user = inMemoryUsers.find(u => u.email === email.toLowerCase());
    }

    // Always respond OK to prevent email enumeration
    if (!user) return res.json({ message: "If this email is registered, a reset link has been sent." });

    // Generate secure token
    const token  = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    if (isConnected()) {
      await User.findByIdAndUpdate(user._id, { resetToken: token, resetTokenExpiry: expiry });
    } else {
      user.resetToken = token;
      user.resetTokenExpiry = expiry;
    }

    const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
    const resetLink = `${APP_URL}/reset-password.html?token=${token}`;

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; background: #f0f4f8; padding: 40px 16px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .header { background: linear-gradient(135deg,#0a1628,#0d2147); border-radius: 16px 16px 0 0; padding: 32px 40px; text-align: center; }
  .header h1 { color: #fff; font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .header h1 span { color: #6c8fff; }
  .body { background: #fff; padding: 36px 40px; }
  .body h2 { color: #0d2147; font-size: 20px; margin-bottom: 14px; }
  .body p { color: #4b5563; font-size: 15px; line-height: 1.8; margin-bottom: 16px; }
  .btn { display: inline-block; background: linear-gradient(135deg,#6c8fff,#a78bfa); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; margin: 8px 0 20px; }
  .note { font-size: 12px; color: #9ca3af; line-height: 1.7; }
  .footer { background: #0a1628; border-radius: 0 0 16px 16px; padding: 24px 40px; text-align: center; }
  .footer p { color: rgba(255,255,255,0.4); font-size: 12px; line-height: 1.8; }
</style></head>
<body>
  <div class="wrap">
    <div class="header"><h1>ZETECH <span>UNIVERSITY</span></h1></div>
    <div class="body">
      <h2>Password Reset Request</h2>
      <p>Hi ${user.name},</p>
      <p>We received a request to reset the password for your Zetech University Student Feedback Portal account. Click the button below to set a new password:</p>
      <div style="text-align:center"><a href="${resetLink}" class="btn">Reset My Password</a></div>
      <p class="note">⏰ This link expires in <strong>1 hour</strong>. If you did not request a password reset, please ignore this email — your account remains secure.<br/><br/>If the button doesn't work, copy and paste this link into your browser:<br/><a href="${resetLink}" style="color:#6c8fff;word-break:break-all">${resetLink}</a></p>
    </div>
    <div class="footer"><p>&copy; ${new Date().getFullYear()} Zetech University &bull; Student Feedback Portal<br/>This is an automated message — please do not reply.</p></div>
  </div>
</body></html>`;

    transporter.sendMail({
      from:    `"Zetech University" <${EMAIL_USER}>`,
      to:      user.email,
      subject: "🔐 Reset Your Password — Zetech University Feedback Portal",
      html
    }, (err, info) => {
      if (err) console.error("❌  Reset email error:", err.message);
      else     console.log("📧  Reset email sent to:", user.email);
    });

    res.json({ message: "If this email is registered, a reset link has been sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not process request." });
  }
});

// Reset Password
app.post("/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ message: "Token and new password are required." });
  if (newPassword.length < 6)  return res.status(400).json({ message: "Password must be at least 6 characters." });

  try {
    let user;
    if (isConnected()) {
      user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: new Date() } });
    } else {
      user = inMemoryUsers.find(u => u.resetToken === token && u.resetTokenExpiry > new Date());
    }

    if (!user) return res.status(410).json({ message: "Reset link is invalid or has expired." });

    const hashed = await bcrypt.hash(newPassword, 10);

    if (isConnected()) {
      await User.findByIdAndUpdate(user._id, { password: hashed, resetToken: null, resetTokenExpiry: null });
    } else {
      user.password = hashed;
      user.resetToken = null;
      user.resetTokenExpiry = null;
    }

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not reset password." });
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


// ── Semester Reminder Scheduler ───────────────────────────────────────────────
//
// Zetech University semesters (3 months each):
//   Semester 1: Jan → Mar  (reminder sent: last week of March   → March 24)
//   Semester 2: Apr → Jun  (reminder sent: last week of June    → June 24)
//   Semester 3: Jul → Sep  (reminder sent: last week of September → Sep 24)
//   Semester 4: Oct → Dec  (reminder sent: last week of December → Dec 24)
//
// Cron runs at 8:00 AM EAT (UTC+3 = 05:00 UTC) on the 24th of Mar/Jun/Sep/Dec

function getSemesterName(month) {
  const map = { 2: "Semester 1 (January – March)", 5: "Semester 2 (April – June)", 8: "Semester 3 (July – September)", 11: "Semester 4 (October – December)" };
  return map[month] || "Current Semester";
}

function buildReminderEmail(studentName, semesterName, deadline) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;padding:40px 16px; }
  .wrap { max-width:580px;margin:0 auto; }
  .header { background:linear-gradient(135deg,#0a1628,#0d2147);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center; }
  .header h1 { color:#fff;font-size:24px;font-weight:700;letter-spacing:1px; }
  .header h1 span { color:#6c8fff; }
  .header p { color:rgba(255,255,255,0.55);font-size:13px;margin-top:6px; }
  .body { background:#fff;padding:40px; }
  .greeting { font-size:21px;font-weight:700;color:#0d2147;margin-bottom:14px; }
  .greeting span { color:#6c8fff; }
  .msg { color:#4b5563;font-size:15px;line-height:1.9;margin-bottom:20px; }
  .highlight {
    background:linear-gradient(135deg,#f0f4ff,#f5f0ff);
    border-left:4px solid #6c8fff;
    border-radius:0 12px 12px 0;
    padding:18px 22px;margin-bottom:24px;
    color:#374151;font-size:14px;line-height:1.8;
  }
  .highlight strong { color:#0d2147; }
  .steps { background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:22px;margin-bottom:24px; }
  .steps h3 { font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6c8fff;margin-bottom:14px; }
  .step { display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;font-size:14px;color:#374151; }
  .step-num { background:#6c8fff;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px; }
  .cta { text-align:center;margin-bottom:24px; }
  .cta a { display:inline-block;background:linear-gradient(135deg,#6c8fff,#a78bfa);color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600; }
  .deadline { text-align:center;font-size:13px;color:#9ca3af;margin-bottom:20px; }
  .deadline strong { color:#f87171; }
  .footer { background:#0a1628;border-radius:0 0 16px 16px;padding:26px 40px;text-align:center; }
  .footer p { color:rgba(255,255,255,0.38);font-size:12px;line-height:1.8; }
  .footer a { color:#6c8fff;text-decoration:none; }
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>ZETECH <span>UNIVERSITY</span></h1>
    <p>Student Feedback Portal — Semester Reminder</p>
  </div>
  <div class="body">
    <div class="greeting">Dear <span>${studentName}</span>,</div>
    <p class="msg">
      As we approach the end of <strong>${semesterName}</strong>, Zetech University kindly
      requests you to take a few minutes to share your feedback on your learning experience
      this semester. Your voice is vital in helping us improve the quality of education we provide.
    </p>
    <div class="highlight">
      📅 <strong>Feedback Deadline:</strong> ${deadline}<br/>
      Your honest feedback helps our academic teams identify areas for improvement, celebrate success,
      and ensure every student receives the best possible learning experience.
    </div>
    <div class="steps">
      <h3>How to submit your feedback</h3>
      <div class="step"><div class="step-num">1</div><span>Visit the Zetech University Feedback Portal</span></div>
      <div class="step"><div class="step-num">2</div><span>Sign in with your Admission Number and password</span></div>
      <div class="step"><div class="step-num">3</div><span>Fill in your course name, rating, and comments</span></div>
      <div class="step"><div class="step-num">4</div><span>Click Submit — it only takes 2 minutes!</span></div>
    </div>
    <div class="cta"><a href="${APP_URL}">Submit My Feedback Now</a></div>
    <div class="deadline">⏰ Deadline: <strong>${deadline}</strong></div>
    <p style="color:#6b7280;font-size:13px;line-height:1.7;text-align:center;">
      If you have already submitted your feedback, thank you! You may disregard this reminder.<br/>
      For support, contact the Student Affairs Office.
    </p>
  </div>
  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} Zetech University &bull; Student Feedback Portal<br/>
    <a href="${APP_URL}">student-feedback-system-bymi.onrender.com</a><br/>
    This is an automated semester reminder. Please do not reply to this email.</p>
  </div>
</div>
</body></html>`;
}

async function sendSemesterReminders() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn("⚠️  Email not configured — skipping semester reminders.");
    return;
  }

  const now          = new Date();
  const month        = now.getMonth(); // 0-indexed
  const semesterName = getSemesterName(month);
  const deadlineDate = new Date(now.getFullYear(), month + 1, 0); // last day of month
  const deadline     = deadlineDate.toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  console.log(`📅  Running semester reminder job for: ${semesterName}`);

  try {
    let students;
    if (isConnected()) {
      students = await User.find({ role: "student" }).lean();
    } else {
      students = inMemoryUsers.filter(u => u.role === "student");
    }

    if (students.length === 0) {
      console.log("ℹ️   No students found to notify.");
      return;
    }

    console.log(`📧  Sending reminders to ${students.length} student(s)…`);

    let sent = 0, failed = 0;
    for (const student of students) {
      try {
        await new Promise((resolve, reject) => {
          transporter.sendMail({
            from:    `"Zetech University" <${EMAIL_USER}>`,
            to:      student.email,
            subject: `📚 Semester Feedback Reminder — ${semesterName} | Zetech University`,
            html:    buildReminderEmail(student.name, semesterName, deadline)
          }, (err, info) => {
            if (err) { console.error(`❌  Failed to send to ${student.email}:`, err.message); failed++; reject(err); }
            else     { console.log(`✅  Reminder sent to ${student.email}`); sent++; resolve(info); }
          });
        });
        // Small delay between emails to avoid Gmail rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch { /* continue with next student */ }
    }

    console.log(`📊  Reminder summary: ${sent} sent, ${failed} failed out of ${students.length} students.`);
  } catch (err) {
    console.error("❌  Semester reminder job error:", err.message);
  }
}

// ── Schedule: 8:00 AM EAT (05:00 UTC) on 24th of March, June, September, December
// Cron: minute hour day month weekday
cron.schedule("0 5 24 3,6,9,12 *", () => {
  console.log("⏰  Semester reminder cron triggered!");
  sendSemesterReminders();
}, { timezone: "Africa/Nairobi" });

console.log("📅  Semester reminder scheduler active — runs on 24th of Mar/Jun/Sep/Dec at 8:00 AM EAT");

// ── Admin: Manual trigger endpoint (for testing) ──────────────────────────────
app.get("/health", (req, res) => {
  const now = new Date();
  const month = now.getMonth();
  const semesters = { 2: "Semester 1 (Jan-Mar)", 5: "Semester 2 (Apr-Jun)", 8: "Semester 3 (Jul-Sep)", 11: "Semester 4 (Oct-Dec)" };
  res.json({
    status: "ok",
    db: isConnected() ? "mongodb" : "in-memory",
    email: EMAIL_USER ? "configured" : "not configured",
    currentSemester: semesters[month] || "Between semesters",
    nextReminderDates: "24th of March, June, September, December at 8:00 AM EAT",
    uptime: process.uptime()
  });
});

// Manual trigger — admin only (for testing)
app.post("/admin/send-reminders", authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ message: "Reminder job started. Check server logs for progress." });
  sendSemesterReminders();
});

app.get("/",           (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/view.html",  (req, res) => res.sendFile(path.join(__dirname, "public", "view.html")));
app.get("/login.html",          (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/reset-password.html", (req, res) => res.sendFile(path.join(__dirname, "public", "reset-password.html")));
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.listen(PORT, () => console.log(`🚀  Server running at http://localhost:${PORT}`));
