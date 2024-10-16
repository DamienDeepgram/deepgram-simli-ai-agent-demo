'use client';
import React, { useState, useRef, use, useEffect } from 'react';
import axios from 'axios';
import { SimliClient } from 'simli-client';

const simli_faceid = '95708b15-bcb8-4d40-a4c5-b233778858b4';

const simliClient = new SimliClient();

const Demo = () => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatgptText, setChatgptText] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const useWebSocket = (url: string) => {
    const [message, setMessage] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<WebSocket | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  
    const blobToUint8Array = (blob: Blob): Promise<Uint8Array> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onloadend = () => {
          if (reader.error) {
            reject(reader.error);
          } else {
            // Assert that reader.result is an ArrayBuffer
            resolve(new Uint8Array(reader.result as ArrayBuffer));
          }
        };
        
        reader.readAsArrayBuffer(blob);
      });
    };
  
    function convertAudio(audioData) {
      // See https://stackoverflow.com/a/61481513 for tips on smooth playback
    
      const audioDataView = new Int16Array(audioData);
    
      if (audioDataView.length === 0) {
        console.error("Received audio data is empty.");
        return;
      }
  
      const audioContext = new (window.AudioContext)({ latencyHint: "interactive", sampleRate: 48000 });
    
      // 1 channel, 48 kHz sample rate
      const audioBuffer = audioContext.createBuffer(
        1,
        audioDataView.length,
        48000
      ); 
      const audioBufferChannel = audioBuffer.getChannelData(0);
    
      // Copy audio data to the buffer
      for (var i = 0; i < audioDataView.length; i++) {
        // Convert linear16 PCM to float [-1, 1]
        audioBufferChannel[i] = audioDataView[i] / 32768; 
      }
      return audioBufferChannel;
    }
  
    const startWebSocket = () => {
      console.log('WebSocket connecting');
      socketRef.current = new WebSocket(url);
      socketRef.current.binaryType = 'arraybuffer';
  
      socketRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const constraints = {
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              autoGainControl: true,
              voiceIsolation: true,
              noiseSuppression: false,
              latency: 0,
            },
          };
          navigator.mediaDevices.getUserMedia(constraints)
            .then((stream) => {
              const audioContext = new AudioContext();
              const microphone = audioContext.createMediaStreamSource(stream);
              const processor = audioContext.createScriptProcessor(4096, 1, 1);
  
              processor.onaudioprocess = function (event) {
                const inputData = event.inputBuffer.getChannelData(0);
                const rms = Math.sqrt(
                  inputData.reduce((sum, value) => sum + value * value, 0) /
                  inputData.length
                );
                var downsampledData = downsample(inputData, 48000, 16000);
                sendAudioData(convertFloat32ToInt16(downsampledData));
              };
  
              microphone.connect(processor);
              processor.connect(audioContext.destination);
            })
            .catch((error) => console.error('Error accessing microphone:', error));
        } else {
          mediaRecorder?.stop();
        }
      };
  
      socketRef.current.onmessage = (event) => {
        console.log('socketRef onmessage', event.data);
        if (typeof event.data === "string") {
          console.log("Text message received:", event.data);
        } else if (event.data instanceof ArrayBuffer) {
          console.log('pcm16Data', event.data);
  
          const chunkSize = 6000;
          for (let i = 0; i < event.data.byteLength; i += chunkSize) {
            const chunk = event.data.slice(i, i + chunkSize);
            const uint8Array = new Uint8Array(chunk);
            simliClient.sendAudioData(uint8Array);
          }
        } else {
          console.log('Received message:', event.data);
        }
      };
  
      socketRef.current.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
      };
  
      socketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };
  
    function downsample(buffer, fromSampleRate, toSampleRate) {
      if (fromSampleRate === toSampleRate) {
        return buffer;
      }
      var sampleRateRatio = fromSampleRate / toSampleRate;
      var newLength = Math.round(buffer.length / sampleRateRatio);
      var result = new Float32Array(newLength);
      var offsetResult = 0;
      var offsetBuffer = 0;
      while (offsetResult < result.length) {
        var nextOffsetBuffer = Math.round(
          (offsetResult + 1) * sampleRateRatio
        );
        var accum = 0, count = 0;
        for (
          var i = offsetBuffer;
          i < nextOffsetBuffer && i < buffer.length;
          i++
        ) {
          accum += buffer[i];
          count++;
        }
        result[offsetResult] = accum / count;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
      }
      return result;
    }
    
    function convertFloat32ToInt16(buffer) {
      var l = buffer.length;
      var buf = new Int16Array(l);
      while (l--) {
        buf[l] = Math.min(1, buffer[l]) * 0x7fff;
      }
      return buf.buffer;
    }
  
    const sendMessage = (msg: string) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(msg);
      }
    };
  
    const sendAudioData = (audioData: ArrayBuffer) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(audioData);
      } else {
        console.log('socket not open', audioData);
      }
    };
  
    // Close the WebSocket connection when the component is unmounted
    useEffect(() => {
      return () => {
        socketRef.current?.close();
      };
    }, []);
  
    return { message, isConnected, sendMessage, sendAudioData, startWebSocket };
  };

  const { message, isConnected, sendMessage, sendAudioData, startWebSocket } = useWebSocket(process.env.NEXT_PUBLIC_SERVER_URL);

  useEffect(() => {
    if (videoRef.current && audioRef.current) {

      // Step 0: Initialize Simli Client
      const SimliConfig = {
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
        faceID: simli_faceid,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
        maxSessionLength: 300, 
        maxIdleTime: 60
      };

      simliClient.Initialize(SimliConfig);

      console.log('Simli Client initialized');
    };

    return () => {
      simliClient.close();
    };
  },[videoRef, audioRef]);

  const handleStart = () => {
    startWebSocket();
    simliClient.on('connected', () => {
      console.log('Simli Client connected');
       // Step 2: Send empty audio data to WebRTC to start rendering
       const audioData = new Uint8Array(6000).fill(0);
       simliClient.sendAudioData(audioData);
    });

    simliClient.on('disconnected', (e) => {
      console.log('SimliClient has disconnected!', e);
    }); 
    
    simliClient.on('failed', (e) => {
        console.log('SimliClient has failed to connect!', e);
    }); 

    // Step 1: Start WebRTC
    simliClient.start();
    setStartWebRTC(true);
    
    audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInputText('');
    setIsLoading(true);
    setError('');

    try {

      // Step 5: Convert audio to Uint8Array (Make sure its of type PCM16)
      const pcm16Data = new Uint8Array([]);
      console.log(pcm16Data);

      // Step 6: Send audio data to WebRTC as 6000 byte chunks
      const chunkSize = 6000;
      for (let i = 0; i < pcm16Data.length; i += chunkSize) {
        const chunk = pcm16Data.slice(i, i + chunkSize);
        simliClient.sendAudioData(chunk);
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <React.StrictMode>
    <div className="bg-black w-full h-svh flex flex-col justify-center items-center font-mono text-white">
      <div className="w-[512px] h-svh flex flex-col justify-center items-center gap-4">
        {/* Simli Client Renderer */}
        <div className="relative w-full aspect-video">
          <video ref={videoRef} id="simli_video" autoPlay playsInline className="w-full h-full object-cover"></video>
          <audio ref={audioRef} id="simli_audio" autoPlay ></audio>
        </div>
        {startWebRTC ? (
          <>
          <div></div>
          </>
        ) : (
          <button
            onClick={handleStart}
            className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
          >
            Start WebRTC
          </button>
        )}
        {error && <p className="mt-4 text-red-500">{error}</p>}
      </div>
    </div>
    </React.StrictMode>
  );
};

export default Demo;