'use client';
import React, { useState, useRef, use, useEffect } from 'react';
import axios from 'axios';
import { SimliClient } from 'simli-client';

const simli_faceid = '95708b15-bcb8-4d40-a4c5-b233778858b4';

const simliClient = new SimliClient();

export const useWebSocket = (url: string) => {
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

  useEffect(() => {
    console.log('WebSocket connecting');
    socketRef.current = new WebSocket(url);

    socketRef.current.onopen = () => {
      setIsConnected(true);
      console.log('WebSocket connected');
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            const recorder = new MediaRecorder(stream);
            setMediaRecorder(recorder);
  
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                console.log('Sending audio to deepgram');
                sendAudioData(event.data);
              }
            };
  
            recorder.start(250); // Record in chunks of 250ms
          })
          .catch((error) => console.error('Error accessing microphone:', error));
      } else {
        mediaRecorder?.stop();
      }
    };

    socketRef.current.onmessage = (event) => {
      console.log('socketRef onmessage', event.data);
      // setMessage(event.data);
      blobToUint8Array(event.data).then((pcm16Data) => {
        // const pcm16Data = new Uint8Array(event.data);
        console.log('pcm16Data', pcm16Data);

        // Step 6: Send audio data to WebRTC as 6000 byte chunks
        const chunkSize = 6000;
        for (let i = 0; i < pcm16Data.length; i += chunkSize) {
          const chunk = pcm16Data.slice(i, i + chunkSize);
          simliClient.sendAudioData(chunk);
        }
      }).catch((error) => {
        console.error('Error converting blob to Uint8Array:', error);
      });
    };

    socketRef.current.onclose = () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    };

    socketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      socketRef.current?.close();
    };
  }, [url]);

  const sendMessage = (msg: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(msg);
    }
  };

  const sendAudioData = (audioData: Blob) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(audioData);
    }
  };

  return { message, isConnected, sendMessage, sendAudioData };
};

const Demo = () => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatgptText, setChatgptText] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const { message, isConnected, sendMessage, sendAudioData } = useWebSocket('ws://localhost:3000');

  useEffect(() => {
    if (videoRef.current && audioRef.current) {

      // Step 0: Initialize Simli Client
      const SimliConfig = {
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
        faceID: simli_faceid,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
      };

      simliClient.Initialize(SimliConfig);

      console.log('Simli Client initialized');
    };

    return () => {
      simliClient.close();
    };
  },[videoRef, audioRef]);

  const handleStart = () => {
    // Step 1: Start WebRTC
    simliClient.start();
    setStartWebRTC(true);

    setTimeout(() => {
      // Step 2: Send empty audio data to WebRTC to start rendering
      const audioData = new Uint8Array(6000).fill(0);
      simliClient.sendAudioData(audioData);
    }, 4000);
    
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