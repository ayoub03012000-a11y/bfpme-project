const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  email: { type: String, unique: true },
  phone: String,
  company_name: String,
  password: String,
  role: String,

  // 👇 الجديد
  status: {
    type: String,
    default: "pending"
  }
});

module.exports = mongoose.model("User", userSchema);