"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Copy, Users, Send, Wifi, WifiOff } from "lucide-react"

interface Message {
  id: string
  sender: string
  content: string
  timestamp: Date
  isOwn: boolean
}

interface Peer {
  id: string
  username: string
  connection: RTCPeerConnection
  dataChannel?: RTCDataChannel
}

export default function P2PChatApp() {
  const [username, setUsername] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map())
  const [messages, setMessages] = useState<Message[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [connectionId, setConnectionId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [isInitiator, setIsInitiator] = useState(false)

  const localConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)

  // WebRTC configuration with public STUN servers
  const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
  }

  useEffect(() => {
    // Generate a unique connection ID
    setConnectionId(Math.random().toString(36).substring(2, 15))
  }, [])

  const addMessage = (sender: string, content: string, isOwn = false) => {
    const message: Message = {
      id: Date.now().toString(),
      sender,
      content,
      timestamp: new Date(),
      isOwn,
    }
    setMessages((prev) => [...prev, message])
  }

  const createPeerConnection = async (isInitiator: boolean, peerId: string) => {
    const pc = new RTCPeerConnection(rtcConfig)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // In a real app, you'd send this through a signaling server
        console.log("ICE Candidate:", event.candidate)
        addMessage("System", `ICE candidate generated (send to peer)`, false)
      }
    }

    pc.onconnectionstatechange = () => {
      addMessage("System", `Connection state: ${pc.connectionState}`, false)
      if (pc.connectionState === "connected") {
        setIsConnected(true)
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setIsConnected(false)
      }
    }

    if (isInitiator) {
      // Create data channel
      const dataChannel = pc.createDataChannel("chat", {
        ordered: true,
      })

      dataChannel.onopen = () => {
        addMessage("System", "Data channel opened", false)
        dataChannelRef.current = dataChannel
      }

      dataChannel.onmessage = (event) => {
        const data = JSON.parse(event.data)
        addMessage(data.sender, data.content, false)
      }

      dataChannel.onerror = (error) => {
        addMessage("System", `Data channel error: ${error}`, false)
      }
    } else {
      // Handle incoming data channel
      pc.ondatachannel = (event) => {
        const dataChannel = event.channel
        dataChannelRef.current = dataChannel

        dataChannel.onopen = () => {
          addMessage("System", "Data channel opened", false)
        }

        dataChannel.onmessage = (event) => {
          const data = JSON.parse(event.data)
          addMessage(data.sender, data.content, false)
        }
      }
    }

    return pc
  }

  const startConnection = async () => {
    if (!username.trim()) {
      addMessage("System", "Please enter a username first", false)
      return
    }

    try {
      setIsInitiator(true)
      const pc = await createPeerConnection(true, "peer")
      localConnectionRef.current = pc

      // Create offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      addMessage("System", "Connection offer created. Share this with your peer:", false)
      addMessage("System", `Offer: ${JSON.stringify(offer)}`, false)
    } catch (error) {
      addMessage("System", `Error creating connection: ${error}`, false)
    }
  }

  const joinConnection = async () => {
    if (!username.trim()) {
      addMessage("System", "Please enter a username first", false)
      return
    }

    if (!targetId.trim()) {
      addMessage("System", "Please paste the offer from your peer", false)
      return
    }

    try {
      setIsInitiator(false)
      const pc = await createPeerConnection(false, "peer")
      localConnectionRef.current = pc

      // Set remote description from offer
      const offer = JSON.parse(targetId)
      await pc.setRemoteDescription(offer)

      // Create answer
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      addMessage("System", "Connection answer created. Send this back to your peer:", false)
      addMessage("System", `Answer: ${JSON.stringify(answer)}`, false)
    } catch (error) {
      addMessage("System", `Error joining connection: ${error}`, false)
    }
  }

  const handleAnswer = async () => {
    if (!targetId.trim() || !localConnectionRef.current) {
      addMessage("System", "Please paste the answer from your peer", false)
      return
    }

    try {
      const answer = JSON.parse(targetId)
      await localConnectionRef.current.setRemoteDescription(answer)
      addMessage("System", "Answer processed. Connection should establish soon.", false)
    } catch (error) {
      addMessage("System", `Error processing answer: ${error}`, false)
    }
  }

  const sendMessage = () => {
    if (!messageInput.trim() || !dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      addMessage("System", "Not connected or no message to send", false)
      return
    }

    const messageData = {
      sender: username,
      content: messageInput.trim(),
    }

    try {
      dataChannelRef.current.send(JSON.stringify(messageData))
      addMessage(username, messageInput.trim(), true)
      setMessageInput("")
    } catch (error) {
      addMessage("System", `Error sending message: ${error}`, false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    addMessage("System", "Copied to clipboard", false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              P2P Encrypted Chat
              {isConnected && (
                <Badge variant="secondary" className="ml-auto">
                  Connected
                </Badge>
              )}
              {!isConnected && (
                <Badge variant="outline" className="ml-auto">
                  Disconnected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Your Username</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  disabled={isConnected}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Your Connection ID</label>
                <div className="flex gap-2">
                  <Input value={connectionId} readOnly />
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(connectionId)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Button onClick={startConnection} disabled={isConnected}>
                Start Connection
              </Button>
              <Button onClick={joinConnection} disabled={isConnected}>
                Join Connection
              </Button>
              <Button onClick={handleAnswer} disabled={isConnected}>
                Process Answer
              </Button>
            </div>

            <div>
              <label className="text-sm font-medium">Peer Data (Offer/Answer)</label>
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="Paste offer or answer from peer here"
                disabled={isConnected}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Chat Messages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 w-full border rounded-md p-4">
                <div className="space-y-2">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.isOwn ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${
                          message.isOwn
                            ? "bg-blue-500 text-white"
                            : message.sender === "System"
                              ? "bg-gray-100 text-gray-800 text-sm"
                              : "bg-gray-200 text-gray-800"
                        }`}
                      >
                        {!message.isOwn && message.sender !== "System" && (
                          <div className="text-xs font-medium mb-1">{message.sender}</div>
                        )}
                        <div className="break-words">{message.content}</div>
                        <div className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex gap-2 mt-4">
                <Input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type your message..."
                  onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                  disabled={!isConnected}
                />
                <Button onClick={sendMessage} disabled={!isConnected}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Connection Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <WifiOff className="h-4 w-4 text-green-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-red-500" />
                  )}
                  <span className="text-sm">{isConnected ? "Connected" : "Disconnected"}</span>
                </div>

                <Separator />

                <div className="text-xs text-gray-600">
                  <p className="font-medium mb-2">How to connect:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Enter username</li>
                    <li>Click "Start Connection"</li>
                    <li>Copy the offer and send to peer</li>
                    <li>Peer pastes offer and clicks "Join"</li>
                    <li>Peer sends answer back</li>
                    <li>Paste answer and click "Process Answer"</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
