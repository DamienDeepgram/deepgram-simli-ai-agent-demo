// Import required modules
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 16000;

const CONFIG = {
    type: "SettingsConfiguration",
    audio: {
        input: {
            encoding: "linear16",
            sample_rate: INPUT_SAMPLE_RATE
        },
        output: {
            encoding: "linear16",
            sample_rate: OUTPUT_SAMPLE_RATE,
            container: "none",
        }
    },
    agent: {
        listen: {
            model: "nova-2"
        },
        think: {
            provider: {
                type: "open_ai"
            },
            model: "gpt-4o-mini",
            instructions: "You are Nikola Tesla the famous inventor! You insist on telling people about all your amazing inventions. Ask people about what ideas they might have and once they tell you, downplay their ideas and start talking about one of your other better ideas."
        },
        speak: {
            model: "aura-helios-en"
        }
    }
}

/*
  Deepgram Streaming Text to Speech
*/
const setupDeepgramWebsocket = (client_ws) => {
  const ws = new WebSocket('wss://agent.deepgram.com/agent', {
    headers: { authorization: `token ${process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY}` }
  });
  ws.binaryType = 'arraybuffer';
  ws.on("open", function open() {
      console.log('deepgram Voice Agent API: Connected');
      ws.send(JSON.stringify(CONFIG));
  });

  ws.on("message", function message(data, isBinary) {
    client_ws.send(data, { binary: isBinary });
  });

  ws.on('close', function close() {
    console.log('deepgram Voice Agent API: Disconnected from the WebSocket server');
  });

  ws.on('error', function error(error) {
    console.log("deepgram Voice Agent API: error received");
    console.error(error);
  });
  return ws;
}

wss.on("connection", (ws) => {
    console.log("socket: client connected");
    let deepgramWebsocket = setupDeepgramWebsocket(ws);

    ws.on("message", (message) => {
        if (deepgramWebsocket.readyState === WebSocket.OPEN) {
          deepgramWebsocket.send(message);
        }
    });

    ws.on("close", () => {
        console.log("socket: client disconnected");
    });
});

server.listen(3001, 'localhost', () => {
    console.log("Server is listening on port 3001");
});