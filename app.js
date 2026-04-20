const User = require("./models/User");
const Dossier = require("./models/Dossier");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
require("./db");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 🔥 SOCKET.IO
const http = require("http").createServer(app);
const { Server } = require("socket.io");

const io = new Server(http, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
});

// ===== CONFIG =====
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const SECRET_KEY = "bfpme_secret_key";

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// ===== JWT =====
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Token manquant" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: "Token invalide" });
  }
}

// ===== ROLES =====
function verifyPersonnel(req, res, next) {
  if (req.user.role !== "personnel") {
    return res.status(403).json({ message: "Accès interdit" });
  }
  next();
}

function verifyAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Accès admin فقط" });
  }
  next();
}

// =========================
// ===== AUTH ==============
// =========================

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  const { first_name, last_name, email, phone, company_name, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ message: "Email déjà utilisé" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const role = email.includes("admin")
      ? "admin"
      : email.includes("staff")
      ? "personnel"
      : "client";

    const user = new User({
      first_name,
      last_name,
      email,
      phone,
      company_name,
      password: hashedPassword,
      role,
      status: role === "client" ? "pending" : "active"
    });

    await user.save();

    res.json({ message: "Inscription réussie", user });
  } catch {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) return res.status(401).json({ message: "Login incorrect" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Login incorrect" });

    if (user.status !== "active") {
      return res.status(403).json({
        message: "Compte en attente de validation"
      });
    }

    const token = jwt.sign(
      {
        email: user.email,
        role: user.role,
        first_name: user.first_name
      },
      SECRET_KEY,
      { expiresIn: "1h" }
    );

    res.json({ message: "Login OK", token, user });
  } catch {
    res.status(500).json({ message: "Erreur serveur" });
  }
});
// =========================
// ===== pasword =============
// =========================
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "Email introuvable"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    await user.save();

    res.json({
      message: "Mot de passe mis à jour avec succès"
    });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur"
    });
  }
});


// =========================
// ===== USERS =============
// =========================

// ACTIVATE USER
app.put("/api/users/:id/activate", verifyToken, verifyPersonnel, async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) return res.status(404).json({ message: "User introuvable" });

  user.status = "active";
  await user.save();

  // 🔥 REALTIME
  io.emit("user_activated", {
    userEmail: user.email
  });

  res.json({ message: "Compte activé", user });
});

// GET USERS
app.get("/api/users", verifyToken, verifyPersonnel, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// =========================
// ===== ADMIN =============
// =========================

app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

app.get("/api/admin/dossiers", verifyToken, verifyAdmin, async (req, res) => {
  const dossiers = await Dossier.find();
  res.json(dossiers);
});

// =========================
// ===== DOSSIERS ==========
// =========================

// CREATE
app.post("/api/dossiers", verifyToken, upload.single("file"), async (req, res) => {
  const { title, description, userEmail } = req.body;

  const dossier = new Dossier({
    title,
    description,
    userEmail,
    status: "en attente",
    file: req.file ? req.file.filename : null
  });

  await dossier.save();

  // 🔥 REALTIME
  io.emit("new_dossier");

  res.json({ message: "Dossier envoyé", dossier });
});

// GET
app.get("/api/dossiers", verifyToken, async (req, res) => {
  const dossiers = await Dossier.find();
  res.json(dossiers);
});

// UPDATE
app.put("/api/dossiers/:id", verifyToken, verifyPersonnel, async (req, res) => {
  const { status, reason } = req.body;

  const dossier = await Dossier.findById(req.params.id);

  if (!dossier) return res.status(404).json({ message: "Introuvable" });

  dossier.status = status;

  if (status === "refusé") {
    dossier.reason = reason || "Aucune raison";
  } else {
    dossier.reason = null;
  }

  await dossier.save();

  // 🔥 REALTIME
  io.emit("dossier_updated", {
    userEmail: dossier.userEmail
  });

  res.json({ message: "Mis à jour", dossier });
});

// =========================
// ===== TEST ==============
// =========================

app.get("/api/me", verifyToken, (req, res) => {
  res.json(req.user);
});

// =========================
// ===== SERVER ============
// =========================

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
