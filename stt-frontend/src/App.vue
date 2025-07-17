<template>
  <div class="stt-app">
    <div class="header">
      <h1>Real-Time Speech-to-Text</h1>
      <div class="status">
        <span :class="['status-indicator', connectionStatus]"></span>
        {{ connectionStatusText }}
      </div>
    </div>

    <!-- Language Selection -->
    <div class="language-section">
      <div class="language-selector">
        <label for="language-select">Language:</label>
        <select 
          id="language-select" 
          v-model="selectedLanguage" 
          :disabled="isRecording"
          class="language-dropdown"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="it">Italian</option>
          <option value="pt">Portuguese</option>
          <option value="ru">Russian</option>
          <option value="ja">Japanese</option>
          <option value="ko">Korean</option>
          <option value="zh">Chinese (Mandarin)</option>
          <option value="ar">Arabic</option>
          <option value="hi">Hindi</option>
          <option value="nl">Dutch</option>
          <option value="sv">Swedish</option>
          <option value="no">Norwegian</option>
          <option value="da">Danish</option>
          <option value="fi">Finnish</option>
          <option value="pl">Polish</option>
          <option value="tr">Turkish</option>
        </select>
        <span class="current-language">{{ getLanguageName(selectedLanguage) }}</span>
      </div>
    </div>

    <div class="controls">
      <button 
        @click="toggleRecording" 
        :disabled="isConnecting"
        :class="['record-btn', { recording: isRecording }]"
      >
        {{ isRecording ? 'Stop Recording' : isConnecting ? 'Connecting...' : 'Start Recording' }}
      </button>
      
      <button 
        @click="playLastRecording" 
        :disabled="!lastRecordingBlob"
        class="play-btn"
      >
        Play Last Recording
      </button>
      
      <button @click="clearTranscripts" class="clear-btn">
        Clear Transcripts
      </button>

      <button @click="toggleDebug" class="debug-btn">
        {{ showDebug ? 'Hide Debug' : 'Show Debug' }}
      </button>
    </div>

    <!-- Debug Panel -->
    <div v-if="showDebug" class="debug-panel">
      <h3>Connection Debug Info</h3>
      <div class="debug-info">
        <p><strong>Backend API:</strong> {{ backendStatus }}</p>
        <p><strong>Speechmatics:</strong> {{ speechmaticsStatus }}</p>
        <p><strong>JWT Token:</strong> {{ jwtToken ? 'Valid' : 'None' }}</p>
        <p><strong>Token Expires:</strong> {{ tokenExpiry || 'N/A' }}</p>
        <p><strong>Selected Language:</strong> {{ selectedLanguage }} ({{ getLanguageName(selectedLanguage) }})</p>
        <p><strong>Audio Format:</strong> {{ debugInfo.audioFormat }}</p>
        <p><strong>Sample Rate:</strong> {{ debugInfo.sampleRate }}</p>
        <p><strong>Last Chunk Size:</strong> {{ debugInfo.lastChunkSize }} bytes</p>
        <p><strong>Total Chunks Sent:</strong> {{ debugInfo.chunksSent }}</p>
      </div>
      
      <div class="debug-controls">
        <button @click="testConnection" class="test-btn">Test Backend Connection</button>
        <button @click="refreshToken" class="test-btn">Refresh JWT Token</button>
        <button @click="downloadLastRecording" :disabled="!lastRecordingBlob" class="test-btn">Download WAV</button>
      </div>
    </div>

    <div class="transcription-area">
      <div class="current-transcript">
        <h3>Live Transcript ({{ getLanguageName(selectedLanguage) }}):</h3>
        <p class="partial-text">{{ partialTranscript }}</p>
      </div>

      <div class="final-transcripts">
        <h3>Final Transcripts:</h3>
        <div class="transcript-list">
          <div 
            v-for="(transcript, index) in finalTranscripts" 
            :key="index"
            class="transcript-item"
          >
            <span class="timestamp">{{ formatTime(transcript.timestamp) }}</span>
            <span class="language-tag">{{ transcript.language }}</span>
            <span class="text">{{ transcript.text }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-message">
      <strong>Error:</strong> {{ error }}
    </div>

    <div v-if="debugLog.length > 0 && showDebug" class="debug-log">
      <h4>Debug Log:</h4>
      <div class="log-entries">
        <div v-for="(log, index) in debugLog" :key="index" class="log-entry">
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RealtimeClient } from '@speechmatics/real-time-client'

// Reactive state
const isConnected = ref(false)
const isConnecting = ref(false)
const isRecording = ref(false)
const connectionStatus = ref('disconnected')
const connectionStatusText = ref('Disconnected')
const partialTranscript = ref('')
const finalTranscripts = ref([])
const error = ref('')
const showDebug = ref(false)
const debugLog = ref([])
const selectedLanguage = ref('en')

// Backend and Speechmatics state
const backendStatus = ref('Unknown')
const speechmaticsStatus = ref('Disconnected')
const jwtToken = ref(null)
const tokenExpiry = ref(null)
const speechmaticsClient = ref(null)

// Language mapping
const languageNames = {
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese (Mandarin)',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'nl': 'Dutch',
  'sv': 'Swedish',
  'no': 'Norwegian',
  'da': 'Danish',
  'fi': 'Finnish',
  'pl': 'Polish',
  'tr': 'Turkish'
}

// Audio processing variables
let audioContext = null;
let mediaStreamSource = null;
let audioWorkletNode = null;
let capturedStream = ref(null);
let recordedChunks = ref([]);
let lastRecordingBlob = ref(null);

// Debug info
const debugInfo = ref({
  audioFormat: 'pcm_f32le',
  sampleRate: 16000,
  channels: 1,
  lastChunkSize: 0,
  chunksSent: 0
});

const BACKEND_URL = 'http://localhost:8080'

const addDebugLog = (message) => {
  debugLog.value.push({
    message,
    timestamp: Date.now()
  });
  console.log(`[DEBUG] ${message}`);
}

const getLanguageName = (code) => {
  return languageNames[code] || code;
}

// Backend API functions
const fetchJwtToken = async () => {
  try {
    addDebugLog('Requesting JWT token from backend...')
    const response = await fetch(`${BACKEND_URL}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 3600 }) // 1 hour
    })

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.success) {
      jwtToken.value = data.token
      tokenExpiry.value = new Date(Date.now() + (data.expiresIn * 1000)).toLocaleString()
      backendStatus.value = 'Connected'
      addDebugLog(`JWT token received, expires: ${tokenExpiry.value}`)
      return data.token
    } else {
      throw new Error(data.error || 'Failed to get token')
    }
  } catch (err) {
    backendStatus.value = 'Error'
    error.value = `Backend connection failed: ${err.message}`
    addDebugLog(`JWT token request failed: ${err.message}`)
    throw err
  }
}

const testConnection = async () => {
  try {
    addDebugLog('Testing backend connection...')
    const response = await fetch(`${BACKEND_URL}/health`)
    const data = await response.json()
    
    if (data.status === 'ok') {
      backendStatus.value = 'Connected'
      addDebugLog('Backend health check passed')
    } else {
      throw new Error('Backend health check failed')
    }
  } catch (err) {
    backendStatus.value = 'Error'
    addDebugLog(`Backend health check failed: ${err.message}`)
  }
}

const refreshToken = async () => {
  try {
    await fetchJwtToken()
  } catch (err) {
    error.value = `Token refresh failed: ${err.message}`
  }
}

// Speechmatics connection
const connectToSpeechmatics = async () => {
  try {
    if (!jwtToken.value) {
      await fetchJwtToken()
    }

    addDebugLog('Connecting to Speechmatics...')
    isConnecting.value = true
    speechmaticsStatus.value = 'Connecting'

    // Create new Speechmatics client
    speechmaticsClient.value = new RealtimeClient()

    // Set up event handlers
    speechmaticsClient.value.addEventListener('receiveMessage', ({ data }) => {
      if (data.message === 'AddPartialTranscript') {
        const partialText = data.results
          .map((r) => r.alternatives?.[0].content)
          .join(' ')
        
        partialTranscript.value = partialText
        addDebugLog(`Partial: "${partialText}"`)
      
      } else if (data.message === 'AddTranscript') {
        const finalText = data.results
          .map((r) => r.alternatives?.[0].content)
          .join(' ')
        
        if (finalText.trim()) {
          finalTranscripts.value.push({
            text: finalText,
            timestamp: Date.now(),
            language: selectedLanguage.value
          })
          partialTranscript.value = ''
          addDebugLog(`Final: "${finalText}"`)
        }
      
      } else if (data.message === 'EndOfTranscript') {
        addDebugLog('Transcription ended by Speechmatics')
        isRecording.value = false
      
      } else if (data.message === 'Error') {
        error.value = data.reason || 'Speechmatics error'
        addDebugLog(`Speechmatics error: ${data.reason}`)
      }
    })

    // Start the Speechmatics session
    await speechmaticsClient.value.start(jwtToken.value, {
      transcription_config: {
        language: selectedLanguage.value,
        enable_partials: true,
        operating_point: 'enhanced',
        max_delay_mode: 'flexible',
        max_delay: 3.0,
        enable_entities: true,
        output_locale: 'en-US',
        transcript_filtering_config: {
          remove_disfluencies: true,
        },
        speaker_diarization_config: {
          max_speakers: 2,
        },
        diarization: 'speaker',
      },
      audio_format: {
        type: 'raw',
        sample_rate: 16000,
        encoding: 'pcm_f32le'
      }
    })

    speechmaticsStatus.value = 'Connected'
    isConnected.value = true
    connectionStatus.value = 'connected'
    connectionStatusText.value = 'Connected to Speechmatics'
    isConnecting.value = false
    
    addDebugLog(`Connected to Speechmatics for language: ${selectedLanguage.value}`)

  } catch (err) {
    speechmaticsStatus.value = 'Error'
    isConnected.value = false
    connectionStatus.value = 'error'
    connectionStatusText.value = 'Connection Failed'
    isConnecting.value = false
    error.value = `Speechmatics connection failed: ${err.message}`
    addDebugLog(`Speechmatics connection failed: ${err.message}`)
    throw err
  }
}

// Audio Worklet Processor
const audioWorkletCode = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputChannel = input[0];
      
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;
        
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: 'audioData',
            data: new Float32Array(this.buffer)
          });
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
`;

// Audio setup
const setupAudioWorklet = async () => {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    const workletBlob = new Blob([audioWorkletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(workletBlob);
    
    await audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);
    
    addDebugLog(`AudioContext created: ${audioContext.sampleRate}Hz`);
    return true;
  } catch (error) {
    addDebugLog(`Failed to setup audio worklet: ${error.message}`);
    return false;
  }
}

// Recording functions
const startRecording = async () => {
  try {
    error.value = '';
    debugInfo.value.chunksSent = 0;
    recordedChunks.value = [];
    
    // Ensure we're connected to Speechmatics
    if (!isConnected.value) {
      await connectToSpeechmatics()
    }

    // Setup audio worklet
    const workletReady = await setupAudioWorklet();
    if (!workletReady) {
      throw new Error('Failed to setup audio processing');
    }

    // Get user media
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    capturedStream.value = stream;
    
    // Create media stream source
    mediaStreamSource = audioContext.createMediaStreamSource(stream);
    
    // Create audio worklet node
    audioWorkletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
    
    // Handle audio data from worklet
    audioWorkletNode.port.onmessage = (event) => {
      if (event.data.type === 'audioData') {
        const pcmData = event.data.data;
        debugInfo.value.lastChunkSize = pcmData.byteLength;
        debugInfo.value.chunksSent++;
        
        // Store for playback
        recordedChunks.value.push(new Float32Array(pcmData));
        
        // Send raw PCM data directly to Speechmatics
        if (speechmaticsClient.value) {
          speechmaticsClient.value.sendAudio(pcmData.buffer);
        }
      }
    };
    
    // Connect the audio graph
    mediaStreamSource.connect(audioWorkletNode);
    
    // Resume audio context if needed
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    isRecording.value = true;
    addDebugLog(`Started recording for language: ${selectedLanguage.value}`);
    
  } catch (err) {
    addDebugLog(`Failed to start recording: ${err.message}`)
    error.value = 'Failed to start recording: ' + err.message
    isRecording.value = false
  }
}

const stopRecording = () => {
  try {
    if (audioWorkletNode) {
      audioWorkletNode.disconnect();
      audioWorkletNode = null;
    }
    
    if (mediaStreamSource) {
      mediaStreamSource.disconnect();
      mediaStreamSource = null;
    }
    
    if (capturedStream.value) {
      capturedStream.value.getTracks().forEach(track => track.stop());
      capturedStream.value = null;
    }
    
    if (audioContext) {
      audioContext.suspend();
    }
    
    // Create a playable blob from recorded chunks
    if (recordedChunks.value.length > 0) {
      createPlayableBlob();
    }
    
    isRecording.value = false;
    addDebugLog('Stopped recording');
    
  } catch (err) {
    addDebugLog(`Error stopping recording: ${err.message}`);
  }
}

// Create playable audio blob
const createPlayableBlob = async () => {
  try {
    if (!audioContext || recordedChunks.value.length === 0) return;
    
    const totalLength = recordedChunks.value.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioBuffer = audioContext.createBuffer(1, totalLength, 16000);
    const channelData = audioBuffer.getChannelData(0);
    
    let offset = 0;
    recordedChunks.value.forEach(chunk => {
      channelData.set(chunk, offset);
      offset += chunk.length;
    });
    
    const wavBuffer = audioBufferToWav(audioBuffer);
    lastRecordingBlob.value = new Blob([wavBuffer], { type: 'audio/wav' });
    
    addDebugLog(`Created playable recording: ${lastRecordingBlob.value.size} bytes`);
  } catch (err) {
    addDebugLog(`Failed to create playable blob: ${err.message}`);
  }
}

// Convert AudioBuffer to WAV
const audioBufferToWav = (buffer) => {
  const length = buffer.length;
  const arrayBuffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(arrayBuffer);
  const channelData = buffer.getChannelData(0);
  
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample * 0x7FFF, true);
    offset += 2;
  }
  
  return arrayBuffer;
}

// UI functions
const toggleRecording = () => {
  if (isRecording.value) {
    stopRecording()
  } else {
    startRecording()
  }
}

const toggleDebug = () => {
  showDebug.value = !showDebug.value
}

const playLastRecording = () => {
  if (lastRecordingBlob.value) {
    try {
      const audio = new Audio();
      audio.src = URL.createObjectURL(lastRecordingBlob.value);
      audio.play().catch(err => {
        addDebugLog(`Audio playback failed: ${err.message}`);
        error.value = 'Failed to play audio: ' + err.message;
      });
      
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(audio.src);
      });
      
      addDebugLog('Started audio playback');
    } catch (err) {
      addDebugLog(`Audio playback error: ${err.message}`);
      error.value = 'Failed to create audio playback: ' + err.message;
    }
  }
}

const downloadLastRecording = () => {
  if (lastRecordingBlob.value) {
    const url = URL.createObjectURL(lastRecordingBlob.value);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording_${selectedLanguage.value}_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    addDebugLog(`Downloaded recording: ${lastRecordingBlob.value.size} bytes`);
  }
}

const clearTranscripts = () => {
  finalTranscripts.value = []
  partialTranscript.value = ''
  error.value = ''
  lastRecordingBlob.value = null
  recordedChunks.value = []
  debugLog.value = []
  debugInfo.value.chunksSent = 0
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString()
}

// Cleanup
const cleanup = () => {
  stopRecording()
  if (speechmaticsClient.value) {
    speechmaticsClient.value.stopRecognition()
  }
  if (audioContext) {
    audioContext.close()
  }
}

onMounted(() => {
  addDebugLog('Application mounted - Direct Speechmatics connection mode')
  testConnection()
})

onUnmounted(cleanup)
</script>

<style scoped>
.stt-app {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #2c3e50;
  border-radius: 10px;
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h1 {
  color: white;
  margin-bottom: 10px;
}

.status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 500;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.status-indicator.connected {
  background-color: #27ae60;
}

.status-indicator.disconnected {
  background-color: #e74c3c;
}

.status-indicator.error {
  background-color: #f39c12;
}

.controls {
  text-align: center;
  margin-bottom: 30px;
  display: flex;
  gap: 15px;
  justify-content: center;
}

.record-btn {
  padding: 12px 24px;
  font-size: 16px;
  border: none;
  border-radius: 25px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 600;
}

.record-btn:not(.recording) {
  background-color: #3498db;
  color: white;
}

.record-btn.recording {
  background-color: #e74c3c;
  color: white;
  animation: pulse 1.5s infinite;
}

.record-btn:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}

.clear-btn {
  padding: 12px 24px;
  font-size: 16px;
  border: 2px solid #95a5a6;
  border-radius: 25px;
  background-color: transparent;
  color: #95a5a6;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 600;
}


.play-btn {
  padding: 12px 24px;
  font-size: 16px;
  border: 2px solid #95a5a6;
  border-radius: 25px;
  background-color: transparent;
  color: #95a5a6;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 600;
}

.clear-btn:hover {
  background-color: #95a5a6;
  color: white;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(231, 76, 60, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(231, 76, 60, 0);
  }
}

.transcription-area {
  background-color: #f8f9fa;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
}

.current-transcript {
  margin-bottom: 30px;
}

.current-transcript h3 {
  color: #2c3e50;
  margin-bottom: 10px;
}

.partial-text {
  background-color: #e8f4fd;
  padding: 15px;
  border-radius: 5px;
  border-left: 4px solid #3498db;
  font-style: italic;
  min-height: 20px;
  color: #2c3e50;
}

.final-transcripts h3 {
  color: #2c3e50;
  margin-bottom: 15px;
}

.full-transcripts {
  max-height: 100px;
  overflow-y: auto;
}


.full-transcripts p {
  color: #2c3e50;
  margin-bottom: 15px;
}

.full-text {
  color: #2c3e50;
}

.transcript-list {
  max-height: 300px;
  overflow-y: auto;
}

.transcript-item {
  display: flex;
  margin-bottom: 10px;
  padding: 10px;
  background-color: white;
  border-radius: 5px;
  border-left: 4px solid #27ae60;
}

.timestamp {
  color: #7f8c8d;
  font-size: 0.9em;
  margin-right: 15px;
  min-width: 100px;
  font-family: monospace;
}

.text {
  flex: 1;
  color: #2c3e50;
}

.error-message {
  background-color: #fadbd8;
  color: #c0392b;
  padding: 15px;
  border-radius: 5px;
  border-left: 4px solid #e74c3c;
  margin-top: 20px;
}

/* Scrollbar styling */
.transcript-list::-webkit-scrollbar {
  width: 6px;
}

.transcript-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.transcript-list::-webkit-scrollbar-thumb {
  background: #bdc3c7;
  border-radius: 3px;
}

.transcript-list::-webkit-scrollbar-thumb:hover {
  background: #95a5a6;
}

.language-section {
  background-color: #f8f9fa;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  text-align: center;
}

.language-selector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  flex-wrap: wrap;
}

.language-selector label {
  font-weight: 600;
  color: #2c3e50;
}

.language-dropdown {
  padding: 8px 12px;
  border: 2px solid #3498db;
  border-radius: 5px;
  background-color: white;
  color: #2c3e50;
  font-size: 14px;
  cursor: pointer;
  min-width: 200px;
}

.language-dropdown:disabled {
  background-color: #ecf0f1;
  cursor: not-allowed;
  opacity: 0.7;
}

.current-language {
  background-color: #3498db;
  color: white;
  padding: 8px 12px;
  border-radius: 5px;
  font-weight: 600;
  font-size: 14px;
}

.language-tag {
  background-color: #3498db;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  margin-right: 10px;
  min-width: 30px;
  text-align: center;
  font-weight: 600;
}

.debug-panel {
  background-color: #f8f9fa;
  border-radius: 10px;
  padding: 20px;
  margin-top: 20px;
  border: 1px solid #e0e0e0;
}

.debug-panel h3 {
  color: #2c3e50;
  margin-bottom: 15px;
  text-align: center;
}

.debug-info p {
  margin-bottom: 10px;
  color: #34495e;
}

.debug-info strong {
  color: #2c3e50;
}

.debug-controls {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.test-btn {
  padding: 8px 15px;
  font-size: 14px;
  border: 2px solid #3498db;
  border-radius: 20px;
  background-color: #3498db;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 600;
}

.test-btn:hover:not(:disabled) {
  background-color: #2980b9;
  border-color: #2980b9;
}

.test-btn:disabled {
  background-color: #bdc3c7;
  border-color: #bdc3c7;
  cursor: not-allowed;
  opacity: 0.7;
}

.debug-log {
  margin-top: 20px;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 10px;
  border: 1px solid #e0e0e0;
}

.debug-log h4 {
  color: #2c3e50;
  margin-bottom: 10px;
  text-align: center;
}

.log-entries {
  max-height: 200px;
  overflow-y: auto;
  padding-right: 10px;
}

.log-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  font-size: 0.9em;
  color: #555;
}

.log-time {
  font-family: monospace;
  color: #7f8c8d;
  margin-right: 10px;
}

.log-message {
  flex: 1;
  word-break: break-all;
}
</style>
