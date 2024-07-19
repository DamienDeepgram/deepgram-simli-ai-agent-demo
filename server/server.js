// Import required modules
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Deepgram Speech to Text
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const deepgramClient = createClient(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY);
let keepAlive;

// OpenAI
const OpenAI = require('openai');
const openai = new OpenAI({
    apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, // This is the default and can be omitted
});

// Deepgram Text to Speech Websocket
const deepgramTTSWebsocketURL = 'wss://api.beta.deepgram.com/v1/speak?model=aura-angus-en&encoding=linear16&sample_rate=16000&container=none';

// Performance Timings
let llmStart = 0;
let ttsStart = 0;
let firstByte = true;
let speaking = false;
let send_first_sentence_input_time = null;
const chars_to_check = [".", ",", "!", "?", ";", ":"]

/*
  OpenAI Streaming LLM
*/
async function promptLLM(deepgramTTSWebsocket, prompt) {
  const stream = openai.beta.chat.completions.stream({
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: [
      {
        role: 'assistant',
        content: `You are an Nikola Tesla. You are from Ireland and have an Irish accent. You love to brag about all your invesntions. You talk about how Elon Must does not even hold a candle to your brilliance.`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
  });

  speaking = true;
  let firstToken = true;
  for await (const chunk of stream) {
    if (speaking) {
      if (firstToken) {
        const end = Date.now();
        const duration = end - llmStart;
        ttsStart = Date.now();
        console.warn('\n>>> openai LLM: Time to First Token = ', duration, '\n');
        firstToken = false;
        firstByte = true;
      }
      chunk_message = chunk.choices[0].delta.content;
      if (chunk_message) {
        process.stdout.write(chunk_message)
        if (!send_first_sentence_input_time && containsAnyChars(chunk_message)){
          send_first_sentence_input_time = Date.now();
        }
        deepgramTTSWebsocket.send(JSON.stringify({ 'type': 'Speak', 'text': chunk_message }));
      }
    }
  }

}

function containsAnyChars(str) {
  // Convert the string to an array of characters
  let strArray = Array.from(str);
  
  // Check if any character in strArray exists in chars_to_check
  return strArray.some(char => chars_to_check.includes(char));
}

/*
  Deepgram Streaming Text to Speech
*/
const setupDeepgramWebsocket = (client_ws) => {
  const options = {
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`
    }
  };
  const ws = new WebSocket(deepgramTTSWebsocketURL, options);

  ws.on('open', function open() {
    console.log('deepgram TTS: Connected');
  });

  ws.on('message', function incoming(data) {
    // Handles barge in
    if (speaking) {
      try {
        let json = JSON.parse(data.toString());
        if (json.type == 'Metadata') {
          console.log('deepgram TTS: ', data.toString());
          return;
        }
      } catch (e) {
        // Ignore
      }
      if (firstByte) {
        const end = Date.now();
        const duration = end - ttsStart;
        console.warn('\n\n>>> deepgram TTS: Time to First Byte = ', duration, '\n');
        firstByte = false;
        if (send_first_sentence_input_time){
          console.log(`>>> deepgram TTS: Time to First Byte from end of sentence token = `, (end - send_first_sentence_input_time));
        }
      }
      console.warn('XXX Sending Audio to Client: ');
      // Send TTS Audio to client browser
      client_ws.send(data);
    }
  });

  ws.on('close', function close() {
    console.log('deepgram TTS: Disconnected from the WebSocket server');
  });

  ws.on('error', function error(error) {
    console.log("deepgram TTS: error received");
    console.error(error);
  });
  return ws;
}

/*
  Deepgram Streaming Speech to Text
*/
const setupDeepgram = (deepgramTTSWebsocket) => {
  let is_finals = [];
  const deepgram = deepgramClient.listen.live({
    // Model
    model: "nova-2",
    language: "en",
    // Formatting
    smart_format: true,
    // End of Speech
    no_delay: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000
  });

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    deepgram.keepAlive(); // Keeps the connection alive
  }, 10 * 1000);

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("deepgram STT: Connected");

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      if (transcript !== "") {
        if (data.is_final) {
          is_finals.push(transcript);
          if (data.speech_final) {
            const utterance = is_finals.join(" ");
            is_finals = [];
            console.log(`deepgram STT: [Speech Final] ${utterance}`);
            llmStart = Date.now();
            promptLLM(deepgramTTSWebsocket, utterance); // Send the final transcript to OpenAI for response
          } else {
            console.log(`deepgram STT:  [Is Final] ${transcript}`);
          }
        } else {
          console.log(`deepgram STT:    [Interim Result] ${transcript}`);
          if (speaking) {
            console.log('twilio: clear audio playback');
            deepgramTTSWebsocket.send(JSON.stringify({ 'type': 'Reset' }));
            speaking = false;
          }
        }
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      if (is_finals.length > 0) {
        console.log("deepgram STT: [Utterance End]");
        const utterance = is_finals.join(" ");
        is_finals = [];
        console.log(`deepgram STT: [Speech Final] ${utterance}`);
        llmStart = Date.now();
        promptLLM(deepgramTTSWebsocket, utterance);
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log("deepgram STT: disconnected");
      clearInterval(keepAlive);
      deepgram.requestClose();
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
      console.log("deepgram STT: error received");
      console.error(error);
    });

    deepgram.addListener(LiveTranscriptionEvents.Warning, async (warning) => {
      console.log("deepgram STT: warning received");
      console.warn(warning);
    });

    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("deepgram STT: metadata received:", data);
    });
  });

  return deepgram;
};

wss.on("connection", (ws) => {
    console.log("socket: client connected");
    let deepgramTTSWebsocket = setupDeepgramWebsocket(ws);
    let deepgram = setupDeepgram(deepgramTTSWebsocket);

    ws.on("message", (message) => {
        console.log("socket: client data received");

        if (deepgram.getReadyState() === 1 /* OPEN */) {
            console.log("socket: data sent to deepgram");
            deepgram.send(message);
        } else if (deepgram.getReadyState() >= 2 /* 2 = CLOSING, 3 = CLOSED */) {
            console.log("socket: data couldn't be sent to deepgram");
            console.log("socket: retrying connection to deepgram");
            /* Attempt to reopen the Deepgram connection */
            deepgram.requestClose();
            deepgram.removeAllListeners();
            deepgram = setupDeepgram(deepgramTTSWebsocket);
        } else {
            console.log("socket: data couldn't be sent to deepgram");
        }
    });

    ws.on("close", () => {
        console.log("socket: client disconnected");
        deepgram.requestClose();
        deepgram.removeAllListeners();
        deepgram = null;
    });
});

server.listen(3000, 'localhost', () => {
    console.log("Server is listening on port 3000");
});