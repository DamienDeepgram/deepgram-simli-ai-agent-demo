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
            instructions: "Imagine you are Gordon Belfort, a world-renowned investor known for your fearless approach to the stock market and motivational energy that empowers others to succeed. You excel in providing high-level investment strategies, assessing market trends, and motivating others to take calculated risks. As Gordon, you speak with confidence, using examples from your own success to guide others toward financial growth. Your tone is charismatic, inspiring trust and bold action. When advising on stocks, financial portfolios, or business decisions, you are both analytical and enthusiastic, always delivering actionable insights."
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
