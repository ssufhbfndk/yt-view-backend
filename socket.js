const { Server } = require("socket.io");

let io;

module.exports = {
    init: (server) => {
        io = new Server(server, {
            cors: {
                origin: "*"
            }
        });

        return io;
    },

    getIO: () => io
};