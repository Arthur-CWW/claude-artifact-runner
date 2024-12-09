import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Core Enums
enum WebSocketMessageType {
  BASE = "websocket_base",
  START = "websocket_start",
  AUDIO = "websocket_audio",
  TRANSCRIPT = "websocket_transcript",
  READY = "websocket_ready",
  STOP = "websocket_stop",
  AUDIO_CONFIG_START = "websocket_audio_config_start",
}

enum EventType {
  TRANSCRIPT = "event_transcript",
  TRANSCRIPT_COMPLETE = "event_transcript_complete",
  PHONE_CALL_CONNECTED = "event_phone_call_connected",
  PHONE_CALL_ENDED = "event_phone_call_ended",
  RECORDING = "event_recording",
  ACTION = "event_action",
}

enum Sender {
  HUMAN = "human",
  BOT = "bot",
  ACTION_WORKER = "action_worker",
  VECTOR_DB = "vector_db",
}

enum AudioEncoding {
  LINEAR16 = "linear16",
  MULAW = "mulaw",
  MP3 = "mp3",
  OPUS = "opus",
}

// Base Interfaces
interface Event {
  conversation_id: string;
}

// Event Interfaces
type ConversationEvent =
  | ({
      type: EventType.TRANSCRIPT;
      text: string;
      sender: Sender;
      timestamp: number;
    } & Event)
  | ({
      type: EventType.PHONE_CALL_CONNECTED;
      to_phone_number: string;
      from_phone_number: string;
    } & Event)
  | ({
      type: EventType.PHONE_CALL_ENDED;
      conversation_minutes: number;
    } & Event)
  | ({
      type: EventType.RECORDING;
      recording_url: string;
    } & Event)
  | ({
      type: EventType.ACTION;
      action_input?: Record<string, unknown>;
      action_output?: Record<string, unknown>;
    } & Event);

// Config Interfaces
interface InputAudioConfig {
  audio_encoding: AudioEncoding;
  sampling_rate: number; // Changed from sample_rate_hertz
  chunk_size: number; // Added required field
  audio_channel_count: number;
}

interface OutputAudioConfig {
  audio_encoding: AudioEncoding;
  sampling_rate: number; // Changed from sample_rate_hertz
  audio_channel_count: number;
}

interface SentimentConfig {
  // Add sentiment config properties as needed
}

interface TranscriberConfig {
  sampling_rate: number;
  audio_encoding: AudioEncoding;
  chunk_size?: number;
  endpointing_config?: any;
}

interface AgentConfig {
  initial_message?: string;
  prompt_preamble?: string;
}

interface SynthesizerConfig {
  type: string;
  sampling_rate: number;
  audio_encoding: AudioEncoding;
  should_encode_as_wav: boolean;
  sentiment_config?: SentimentConfig;
}
// WebSocket Message Types
type WebSocketMessage =
  | {
      type: WebSocketMessageType.AUDIO;
      data: string;
    }
  | {
      type: WebSocketMessageType.TRANSCRIPT;
      text: string;
      sender: Sender;
      timestamp: number;
    }
  | {
      type: WebSocketMessageType.START;
      transcriber_config: TranscriberConfig;
      agent_config: AgentConfig;
      synthesizer_config: SynthesizerConfig;
      conversation_id?: string;
    }
  | {
      type: WebSocketMessageType.AUDIO_CONFIG_START;
      input_audio_config: InputAudioConfig;
      output_audio_config: OutputAudioConfig;
      conversation_id?: string;
      subscribe_transcript?: boolean;
    }
  | {
      type: WebSocketMessageType.READY;
    }
  | {
      type: WebSocketMessageType.STOP;
    };

const WebSocketClient = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [error, setError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const connectWebSocket = (aiProfileId: number) => {
    try {
      const ws = new WebSocket(
        `ws://localhost:3000/websocket_call/${aiProfileId}`
      );

      ws.onopen = () => {
        setIsConnected(true);
        setError("");

        const configMessage = {
          type: WebSocketMessageType.AUDIO_CONFIG_START,
          input_audio_config: {
            audio_encoding: AudioEncoding.LINEAR16, // this is done on the python side
            sampling_rate: 48000,
            chunk_size: 2048, // Added required chunk_size
            audio_channel_count: 1,
          },
          output_audio_config: {
            audio_encoding: AudioEncoding.LINEAR16,
            sampling_rate: 16000,
            audio_channel_count: 1,
          },
          subscribe_transcript: true,
        } satisfies WebSocketMessage;
        ws.send(JSON.stringify(configMessage));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log("Received message:", message); // Debug log
          setMessages((prev) => [...prev, message]);

          if (message.type === WebSocketMessageType.READY) {
            startRecording();
          } else if (message.type === WebSocketMessageType.AUDIO) {
            playAudio(message.data);
          }
        } catch (err) {
          console.error("Error parsing message:", err);
          setError("Failed to parse WebSocket message");
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("WebSocket error occurred");
      };

      ws.onclose = () => {
        setIsConnected(false);
        stopRecording();
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Connection error:", err);
      setError("Failed to connect to WebSocket server");
    }
  };
  const sampleRate = 48000; // Match the server and your desired rate
  const chunkSize = 2048;

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create AudioContext and connect the stream
    const audioContext = new AudioContext({ sampleRate });
    const source = audioContext.createMediaStreamSource(stream);

    // Create a ScriptProcessorNode with a 2048 frame buffer
    const processor = audioContext.createScriptProcessor(chunkSize, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
      // Give up on webm encoding ;(
      // Webm not sending the raw bytes
      const inputBuffer = event.inputBuffer.getChannelData(0);

      // Convert int16 to base64
      // const uint8View = new Uint8Array(inputBuffer.buffer);
      // const int8 = Array.from(uint8View);
      // const base64data = btoa(String.fromCharCode.apply(null, int8));

      // const base64data = btoa(
      //   String.fromCharCode.apply(null, Array.from(inputBuffer))
      // );
      // This function is only provided for compatibility with legacy web platform APIs and should never be used in new code, because they use strings to represent binary data and predate the introduction of typed arrays in JavaScript. For code running using Node.js APIs, converting between base64-encoded strings and binary data should be performed using Buffer.from(str, 'base64') and buf.toString('base64').
      const base64data = btoa(
        String.fromCharCode(...new Uint8Array(inputBuffer.buffer))
      );
      // Only works in node
      // const base64data = Buffer.from(inputBuffer).toString("base64");
      // console.assert(method2 === base64data, "method2 !== base64data");

      // Send via WebSocket
      const audioMessage = {
        type: "websocket_audio", // your message type
        data: base64data,
      };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(audioMessage));
      }
    };
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
    setIsRecording(false);
  };

  const disconnect = () => {
    if (wsRef.current) {
      const stopMessage = {
        type: WebSocketMessageType.STOP,
      } satisfies WebSocketMessage;
      wsRef.current.send(JSON.stringify(stopMessage));
      wsRef.current.close();
    }
    stopRecording();
  };

  const playAudio = async (audioData: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      // Decode base64 audio data
      // const binaryData = atob(audioData);
      // const arrayBuffer = new ArrayBuffer(binaryData.length);
      // const view = new Uint8Array(arrayBuffer);
      // for (let i = 0; i < binaryData.length; i++) {
      //   view[i] = binaryData.charCodeAt(i);
      // }
      const arrayBuffer = Uint8Array.from(atob(audioData), (c) =>
        c.charCodeAt(0)
      ).buffer;
      // Decode audio data and play it
      const audioBuffer = await audioContextRef.current.decodeAudioData(
        arrayBuffer
      );
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error("Error playing audio:", err);
      setError("Failed to play audio response");
    }
  };

  useEffect(() => {
    return () => {
      disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>WebSocket Call Interface</span>
          <Badge variant={isConnected ? "default" : "destructive"}>
            {isConnected ? "Connected" : "Disconnected"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex space-x-2">
          <Button
            onClick={() => connectWebSocket(145)}
            disabled={isConnected}
            className="flex-1"
          >
            <Phone className="mr-2 h-4 w-4" />
            Connect
          </Button>

          <Button
            onClick={disconnect}
            disabled={!isConnected}
            variant="destructive"
            className="flex-1"
          >
            <PhoneOff className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        </div>

        <div className="flex items-center justify-center p-4">
          {isRecording ? (
            <Mic className="h-12 w-12 text-green-500 animate-pulse" />
          ) : (
            <MicOff className="h-12 w-12 text-gray-300" />
          )}
        </div>

        <div className="h-64 overflow-y-auto border rounded-lg p-4 space-y-2">
          {messages.map((message, index) => (
            <div key={index} className="text-sm">
              <div className="flex items-center space-x-2">
                <Badge variant="outline">{message.type}</Badge>
                {message.type === WebSocketMessageType.TRANSCRIPT && (
                  <>
                    <Badge
                      variant={
                        message.sender === Sender.BOT ? "secondary" : "default"
                      }
                    >
                      {message.sender}
                    </Badge>
                    <span>{message.text}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default WebSocketClient;
