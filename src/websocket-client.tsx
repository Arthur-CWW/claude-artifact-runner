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
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};
// useWebSocketAudio.ts

const encodeWAV = (
  pcmData: Uint8Array,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number
): ArrayBuffer => {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < pcmData.length; i++) {
    view.setUint8(44 + i, pcmData[i]);
  }

  return buffer;
};

interface WebSocketConfig {
  url: string;
  sampleRate?: number;
  chunkSize?: number;
  channelCount?: number;
}

interface UseWebSocketAudioReturn {
  isConnected: boolean;
  isRecording: boolean;
  error: string;
  messages: WebSocketMessage[];
  connect: (profileId?: string) => void;
  disconnect: () => void;
  toggleRecording: () => void;
}

export const useWebSocketAudio = ({
  url,
  sampleRate = 48000,
  chunkSize = 2048,
  channelCount = 1,
}: WebSocketConfig): UseWebSocketAudioReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [error, setError] = useState("");

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current) {
      return;
    }

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift();

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate });
      }

      const binaryData = atob(audioData!);
      const arrayBuffer = new ArrayBuffer(binaryData.length);
      const view = new Uint8Array(arrayBuffer);

      for (let i = 0; i < binaryData.length; i++) {
        view[i] = binaryData.charCodeAt(i);
      }

      const wavBuffer = encodeWAV(view, sampleRate, channelCount, 16);
      const audioBuffer = await audioContextRef.current.decodeAudioData(
        wavBuffer
      );

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        playNextInQueue();
      };

      source.start();
    } catch (err) {
      console.error("Error playing audio:", err);
      isPlayingRef.current = false;
      playNextInQueue();
    }
  };

  const queueAudio = (audioData: string) => {
    audioQueueRef.current.push(audioData);
    if (!isPlayingRef.current) {
      playNextInQueue();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate });
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(
        chunkSize,
        channelCount,
        channelCount
      );

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer.getChannelData(0);
        const base64data = btoa(
          String.fromCharCode(...new Uint8Array(inputBuffer.buffer))
        );

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "websocket_audio",
              data: base64data,
            })
          );
        }
      };

      processorRef.current = processor;
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Failed to start recording");
    }
  };

  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  const connect = (profileId?: string) => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        setError("");

        const configMessage = {
          type: "websocket_audio_config_start",
          input_audio_config: {
            audio_encoding: "linear16",
            sampling_rate: sampleRate,
            chunk_size: chunkSize,
            audio_channel_count: channelCount,
          },
          output_audio_config: {
            audio_encoding: "linear16",
            sampling_rate: sampleRate,
            audio_channel_count: channelCount,
          },
          subscribe_transcript: true,
          conversation_id: profileId,
        };
        ws.send(JSON.stringify(configMessage));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setMessages((prev) => [...prev, message]);

          if (message.type === "websocket_ready") {
            startRecording();
          } else if (message.type === "websocket_audio") {
            queueAudio(message.data);
          }
        } catch (err) {
          console.error("Error parsing message:", err);
          setError("Failed to parse WebSocket message");
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
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

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "websocket_stop" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    stopRecording();
    setIsConnected(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
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

  return {
    isConnected,
    isRecording,
    error,
    messages,
    connect,
    disconnect,
    toggleRecording,
  };
};
const WebSocketClient = () => {
  const {
    isConnected,
    isRecording,
    error,
    messages,
    connect,
    disconnect,
    toggleRecording,
  } = useWebSocketAudio({
    url: "ws://localhost:3000/websocket_call",
    sampleRate: 48000,
    chunkSize: 2048,
    channelCount: 1,
  });

  const listAudioDevices = async () => {
    // Get both input and output devices
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Log each device
    for (const device of devices) {
      if (device.kind === "audiooutput" || device.kind === "audioinput") {
        console.log(`Type: ${device.kind}`);
        console.log(`Label: ${device.label}`);
        console.log(`ID: ${device.deviceId}`);

        // Try to get capabilities for input devices
        if (device.kind === "audioinput") {
          try {
            const constraints = {
              audio: {
                deviceId: { exact: device.deviceId },
                sampleRate: { ideal: 48000 }, // Try a common rate
              },
            };

            const stream = await navigator.mediaDevices.getUserMedia(
              constraints
            );
            const track = stream.getAudioTracks()[0];
            const capabilities = track.getCapabilities();
            console.log("Capabilities:", capabilities);

            // Clean up
            stream.getTracks().forEach((track) => track.stop());
          } catch (e) {
            console.log("Could not get capabilities:", e);
          }
        }
        console.log("-------------------");
      }
    }
  };
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
            onClick={() => connect()}
            disabled={isConnected}
            className="flex-1"
          >
            <Phone className="mr-2 h-4 w-4" />
            Connect
          </Button>
          <Button onClick={listAudioDevices}>sampling</Button>

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

        <div
          className="flex items-center justify-center p-4"
          onClick={() => toggleRecording()}
        >
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
