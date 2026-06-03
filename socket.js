const { Server } = require("socket.io");

let io;

module.exports = {
    init: (server) => {
        io = new Server(server, {
            cors: {
    origin: "https://ythub.lat",
    credentials: true
  }
        });

        return io;
    },

    getIO: () => io
};