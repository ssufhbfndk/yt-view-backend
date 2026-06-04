const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require('path');
const http = require("http");
const socket = require("./socket");
const userRoutes = require("./routes/userRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const clientUserRoutes = require("./routes/clientUser");
const externalOrderRoute = require('./routes/externalOrder');
const paymentRoutes = require("./routes/paymentRoutes")
const dashboardRoutes = require("./routes/dashboardRoutes");
const otpRoutes = require("./routes/otpRoutes");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = socket.init(server);

io.on("connection", (socket) => {

  console.log("Client connected:", socket.id);

  socket.on("join_admin", () => {
    socket.join("admin-room");
  });

});

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser()); // ✅ For parsing cookies



const corsOptions = {
  origin: [
     "https://ythub.lat",
    "https://www.ythub.lat",
    "http://localhost:3000",
    "https://yt-view-front.vercel.app",
    "exp://localhost:19000",
    "http://localhost",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));





// Test Route
//app.get("/", (req, res) => res.send("✅ Server is Running!"));

// Routes
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/clientUser", clientUserRoutes);
app.use('/api', externalOrderRoute);
app.use('/api/payment', paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/otp", otpRoutes);
// React build folder serve karo (outside current dir)
app.use(express.static(path.join(__dirname, '..', 'yt-view-front', 'build')));

// SPA ke liye fallback
app.get('*', (req, res) => {
  // If route starts with /api and no API route matched, return 404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API not found' });
  }

  // Otherwise serve the React app (for React Router)
  res.sendFile(path.join(__dirname, '..', 'yt-view-front', 'build', 'index.html'));
  
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

