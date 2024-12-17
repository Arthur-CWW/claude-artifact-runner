import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 8000; // Twilio default
const BUFFER_SIZE = 2048;

// Simple mulaw encoder (simplified for demo)
const encodeMulaw = (pcm) => {
  const bias = 0x84;
  const clip = 32635;
  const sign = (pcm & 0x8000) >> 8;

  if (sign !== 0) pcm = -pcm;
  if (pcm > clip) pcm = clip;

  pcm += bias;
  const exponent = Math.floor(Math.log(pcm) / Math.log(2));
  const mantissa = (pcm >> (exponent - 3)) & 0x0f;

  return ~(sign | (exponent << 4) | mantissa);
};

const TwilioDebugClient = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [outputEncoding, setOutputEncoding] = useState("mulaw");
  const [error, setError] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioBuffersRef = useRef<Uint8Array[]>([]);

  useEffect(() => {
    return () => {
      stopRecording();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          window.webkitAudioContext)({
          sampleRate: SAMPLE_RATE,
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNodeRef.current =
        audioContextRef.current.createMediaStreamSource(stream);

      // Create audio processor
      processorNodeRef.current = audioContextRef.current.createScriptProcessor(
        BUFFER_SIZE,
        1,
        1
      );

      processorNodeRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // Convert to required format
        const encodedData =
          outputEncoding === "mulaw"
            ? new Uint8Array(inputData.length).map((_, i) =>
                encodeMulaw(Math.floor(inputData[i] * 32768))
              )
            : new Int16Array(inputData.map((s) => s * 32768));

        // Store for playback
        audioBuffersRef.current.push(encodedData);

        // Simulate network delay
        setTimeout(() => {
          if (isPlaying) {
            playAudioBuffer(encodedData);
          }
        }, 100);
      };

      sourceNodeRef.current.connect(processorNodeRef.current);
      processorNodeRef.current.connect(audioContextRef.current.destination);

      setIsRecording(true);
      setIsConnected(true);
    } catch (err) {
      console.error("Recording error:", err);
      setError("Failed to start recording");
    }
  };

  const stopRecording = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      processorNodeRef.current.disconnect();
    }
    setIsRecording(false);
    setIsConnected(false);
  };

  const playAudioBuffer = (buffer) => {
    if (!audioContextRef.current) return;

    const audioBuffer = audioContextRef.current.createBuffer(
      1,
      buffer.length,
      SAMPLE_RATE
    );

    // Convert back to float32
    const channelData = audioBuffer.getChannelData(0);
    if (outputEncoding === "mulaw") {
      // Simple mulaw decoder
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 255;
      }
    } else {
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768;
      }
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.start();
  };

  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Twilio Debug Client</span>
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

        <div className="flex items-center space-x-4">
          <Select value={outputEncoding} onValueChange={setOutputEncoding}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Output Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mulaw">μ-law</SelectItem>
              <SelectItem value="linear16">Linear16</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={isConnected ? stopRecording : startRecording}
            variant={isConnected ? "destructive" : "default"}
          >
            {isConnected ? (
              <PhoneOff className="mr-2 h-4 w-4" />
            ) : (
              <Phone className="mr-2 h-4 w-4" />
            )}
            {isConnected ? "Disconnect" : "Connect"}
          </Button>

          <Button
            onClick={togglePlayback}
            variant={isPlaying ? "destructive" : "default"}
            disabled={!isConnected}
          >
            {isPlaying ? (
              <VolumeX className="mr-2 h-4 w-4" />
            ) : (
              <Volume2 className="mr-2 h-4 w-4" />
            )}
            {isPlaying ? "Mute" : "Unmute"}
          </Button>
        </div>

        <div className="flex items-center justify-center p-4">
          {isRecording ? (
            <Mic className="h-12 w-12 text-green-500 animate-pulse" />
          ) : (
            <MicOff className="h-12 w-12 text-gray-300" />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TwilioDebugClient;
