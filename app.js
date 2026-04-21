const User = require("./models/User");
const Dossier = require("./models/Dossier");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const app = express();

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

// Static files
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Root page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Config
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SOCKET.IO
const http = require("http").createServer(app);
const { Server } = require("socket.io");

const io = new Server(http, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
});

const SECRET_KEY = "bfpme_secret_key";

// MULTER
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// JWT
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

function verifyPersonnel(req, res, next) {
  if (req.user.role !== "personnel") {
    return res.status(403).json({ message: "Accès interdit" });
  }
  next();
}

function verifyAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Accès admin interdit" });
  }
  next();
}

// AUTH
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
  } catch (error) {
    console.log("REGISTER ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Login incorrect" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Login incorrect" });
    }

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
  } catch (error) {
    console.log("LOGIN ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

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
    console.log("FORGOT PASSWORD ERROR:", error);
    res.status(500).json({
      message: "Erreur serveur"
    });
  }
});

// USERS
app.put("/api/users/:id/activate", verifyToken, verifyPersonnel, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User introuvable" });

    user.status = "active";
    await user.save();

    io.emit("user_activated", {
      userEmail: user.email
    });

    res.json({ message: "Compte activé", user });
  } catch (error) {
    console.log("ACTIVATE USER ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.get("/api/users", verifyToken, verifyPersonnel, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    console.log("GET USERS ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// ADMIN
app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    console.log("ADMIN USERS ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.get("/api/admin/dossiers", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const dossiers = await Dossier.find();
    res.json(dossiers);
  } catch (error) {
    console.log("ADMIN DOSSIERS ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// DOSSIERS
app.post("/api/dossiers", verifyToken, upload.single("file"), async (req, res) => {
  try {
    const { title, description, userEmail } = req.body;

    const dossier = new Dossier({
      title,
      description,
      userEmail,
      status: "en attente",
      file: req.file ? req.file.filename : null
    });

    await dossier.save();

    io.emit("new_dossier");

    res.json({ message: "Dossier envoyé", dossier });
  } catch (error) {
    console.log("CREATE DOSSIER ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.get("/api/dossiers", verifyToken, async (req, res) => {
  try {
    const dossiers = await Dossier.find();
    res.json(dossiers);
  } catch (error) {
    console.log("GET DOSSIERS ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.put("/api/dossiers/:id", verifyToken, verifyPersonnel, async (req, res) => {
  try {
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

    io.emit("dossier_updated", {
      userEmail: dossier.userEmail
    });

    res.json({ message: "Mis à jour", dossier });
  } catch (error) {
    console.log("UPDATE DOSSIER ERROR:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

app.get("/api/me", verifyToken, (req, res) => {
  res.json(req.user);
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});