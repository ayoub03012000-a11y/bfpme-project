const mongoose = require("mongoose");

mongoose
  .connect("mongodb+srv://ayoub03012000_db_user:ssZzhsPLMJp9uBe@cluster0.bqzdn81.mongodb.net/bfpme?retryWrites=true&w=majority")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ MongoDB error:", err));