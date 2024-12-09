import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const WebSocketClient = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  const connectWebSocket = (aiProfileId: string) => {
    try {
      const ws = new WebSocket(
        `ws://localhost:8000/websocket_call/${aiProfileId}`
      );

      ws.onopen = () => {
        setIsConnected(true);
        setError("");

        // Send initial audio config message
        const configMessage = {
          type: "websocket_audio_config_start",
          input_audio_config: {
            audio_encoding: "linear16",
            sample_rate_hertz: 16000,
            audio_channel_count: 1,
          },
          output_audio_config: {
            audio_encoding: "linear16",
            sample_rate_hertz: 16000,
            audio_channel_count: 1,
          },
          subscribe_transcript: true,
        };
        ws.send(JSON.stringify(configMessage));
      };

      ws.onmessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data);
        setMessages((prev) => [...prev, message]);

        if (message.type === "websocket_ready") {
          // Ready to start streaming audio
          startRecording();
        }
      };

      ws.onerror = (error) => {
        setError("WebSocket error occurred");
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        setIsConnected(false);
        stopRecording();
      };

      wsRef.current = ws;
    } catch (err) {
      setError("Failed to connect to WebSocket server");
      console.error("Connection error:", err);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (
          event.data.size > 0 &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          // Convert blob to base64
          const reader = new FileReader();
          reader.onload = () => {
            const base64data = reader.result.split(",")[1];
            const audioMessage = {
              type: "websocket_audio",
              data: base64data,
            };
            wsRef.current.send(JSON.stringify(audioMessage));
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(100); // Collect 100ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      setError("Failed to start recording");
      console.error("Recording error:", err);
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
      const stopMessage = {
        type: "websocket_stop",
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
              <span className="font-semibold">{message.type}:</span>
              {message.type === "websocket_transcript" && (
                <span className="ml-2">{message.text}</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default WebSocketClient;
