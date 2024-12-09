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
}

enum SynthesizerType {
  BASE = "base",
}

// Base Interfaces
interface Event {
  conversation_id: string;
}

interface TypedModel {
  type: string;
}

// Event Interfaces
interface TranscriptEvent extends Event {
  type: EventType.TRANSCRIPT;
  text: string;
  sender: Sender;
  timestamp: number;
}

interface PhoneCallConnectedEvent extends Event {
  type: EventType.PHONE_CALL_CONNECTED;
  to_phone_number: string;
  from_phone_number: string;
}

interface PhoneCallEndedEvent extends Event {
  type: EventType.PHONE_CALL_ENDED;
  conversation_minutes: number;
}

interface RecordingEvent extends Event {
  type: EventType.RECORDING;
  recording_url: string;
}

interface ActionEvent extends Event {
  type: EventType.ACTION;
  action_input?: Record<string, any>;
  action_output?: Record<string, any>;
}

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

// WebSocket Message Interfaces
interface WebSocketMessage extends TypedModel {
  type: WebSocketMessageType;
}

interface AudioMessage extends WebSocketMessage {
  type: WebSocketMessageType.AUDIO;
  data: string;
}

interface TranscriptMessage extends WebSocketMessage {
  type: WebSocketMessageType.TRANSCRIPT;
  text: string;
  sender: Sender;
  timestamp: number;
}

interface StartMessage extends WebSocketMessage {
  type: WebSocketMessageType.START;
  transcriber_config: TranscriberConfig;
  agent_config: AgentConfig;
  synthesizer_config: SynthesizerConfig;
  conversation_id?: string;
}

interface AudioConfigStartMessage extends WebSocketMessage {
  type: WebSocketMessageType.AUDIO_CONFIG_START;
  input_audio_config: InputAudioConfig;
  output_audio_config: OutputAudioConfig;
  conversation_id?: string;
  subscribe_transcript?: boolean;
}

interface ReadyMessage extends WebSocketMessage {
  type: WebSocketMessageType.READY;
}

interface StopMessage extends WebSocketMessage {
  type: WebSocketMessageType.STOP;
}

const WebSocketClient = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [error, setError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const connectWebSocket = (aiProfileId: string) => {
    try {
      const ws = new WebSocket(
        `ws://localhost:3000/websocket_call/${aiProfileId}`
      );

      ws.onopen = () => {
        setIsConnected(true);
        setError("");

        const configMessage: AudioConfigStartMessage = {
          type: WebSocketMessageType.AUDIO_CONFIG_START,
          input_audio_config: {
            audio_encoding: AudioEncoding.LINEAR16,
            sampling_rate: 16000,
            chunk_size: 2048, // Added required chunk_size
            audio_channel_count: 1,
          },
          output_audio_config: {
            audio_encoding: AudioEncoding.LINEAR16,
            sampling_rate: 16000,
            audio_channel_count: 1,
          },
          subscribe_transcript: true,
        };
        ws.send(JSON.stringify(configMessage));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log("Received message:", message); // Debug log
          setMessages((prev) => [...prev, message]);

          if (message.type === WebSocketMessageType.READY) {
            startRecording();
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (
          event.data.size > 0 &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64data = (reader.result as string).split(",")[1];
            const audioMessage: AudioMessage = {
              type: WebSocketMessageType.AUDIO,
              data: base64data,
            };
            console.log("Sending audio message:", audioMessage); // Debug log
            wsRef.current?.send(JSON.stringify(audioMessage));
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Recording error:", err);
      setError("Failed to start recording");
    }
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
      const stopMessage: StopMessage = {
        type: WebSocketMessageType.STOP,
      };
      wsRef.current.send(JSON.stringify(stopMessage));
      wsRef.current.close();
    }
    stopRecording();
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>WebSocket Call Interface</span>
          <Badge variant={isConnected ? "success" : "destructive"}>
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
            onClick={() => connectWebSocket("test-profile")}
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
                        (message as TranscriptMessage).sender === Sender.BOT
                          ? "secondary"
                          : "default"
                      }
                    >
                      {(message as TranscriptMessage).sender}
                    </Badge>
                    <span>{(message as TranscriptMessage).text}</span>
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
