const mongoose = require("mongoose");

mongoose.connect("mongodb+srv://ayoub03012000_db_user:AaPPV03F7YUhkhHq@cluster0.bqzdn81.mongodb.net/mydb?retryWrites=true&w=majority")
  .then(() => console.log("✅ MongoDB connecté"))
  .catch(err => console.error("❌ MongoDB error:", err));