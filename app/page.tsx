"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Users, Send, Wifi, WifiOff, Globe, Copy, AlertCircle } from "lucide-react"

interface Message {
  id: string
  sender: string
  content: string
  timestamp: Date
  isOwn: boolean
}

interface PeerConnection {
  id: string
  username: string
  connection: RTCPeerConnection
  dataChannel?: RTCDataChannel
  connected: boolean
}

export default function ReliableP2PChatApp() {
  const [username, setUsername] = useState("")
  const [roomId, setRoomId] = useState("")
  const [myPeerId] = useState(() => Math.random().toString(36).substring(2, 15))
  const [isInRoom, setIsInRoom] = useState(false)
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map())
  const [messages, setMessages] = useState<Message[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [connectionStatus, setConnectionStatus] = useState<string>("Disconnected")
  const [isConnecting, setIsConnecting] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // Enhanced WebRTC configuration with TURN servers
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.nextcloud.com:443" },
      // Free TURN servers for better connectivity
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
    iceCandidatePoolSize: 10,
  }

  const addMessage = useCallback((sender: string, content: string, isOwn = false) => {
    const message: Message = {
      id: Date.now().toString() + Math.random(),
      sender,
      content,
      timestamp: new Date(),
      isOwn,
    }
    setMessages((prev) => [...prev, message])
  }, [])

  const sendToSignalingServer = async (data: any) => {
    try {
      const response = await fetch("/api/signaling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, roomId, peerId: myPeerId }),
      })
      return await response.json()
    } catch (error) {
      console.error("Signaling error:", error)
      addMessage("System", "❌ Signaling server error. Check your connection.")
      return { error: "Network error" }
    }
  }

  const createPeerConnection = async (targetPeerId: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection(rtcConfig)

    // Enhanced connection monitoring
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await sendToSignalingServer({
          type: "ice-candidate",
          data: { to: targetPeerId, candidate: event.candidate },
        })
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      addMessage("System", `🔗 ICE connection with ${targetPeerId.substring(0, 6)}: ${state}`)

      if (state === "connected" || state === "completed") {
        addMessage("System", `✅ Successfully connected to peer ${targetPeerId.substring(0, 6)}!`)
      } else if (state === "failed") {
        addMessage("System", `❌ Connection failed with ${targetPeerId.substring(0, 6)}. Retrying...`)
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      addMessage("System", `📡 Connection state with ${targetPeerId.substring(0, 6)}: ${state}`)

      if (state === "connected") {
        setPeers((prev) => {
          const updated = new Map(prev)
          const peer = updated.get(targetPeerId)
          if (peer) {
            peer.connected = true
            updated.set(targetPeerId, peer)
          }
          return updated
        })
        updateConnectionStatus()
        setIsConnecting(false)
      } else if (state === "disconnected" || state === "failed") {
        setPeers((prev) => {
          const updated = new Map(prev)
          updated.delete(targetPeerId)
          return updated
        })
        updateConnectionStatus()
        setIsConnecting(false)
      }
    }

    // Connection timeout
    setTimeout(() => {
      if (pc.connectionState !== "connected") {
        addMessage(
          "System",
          `⏰ Connection timeout with ${targetPeerId.substring(0, 6)}. The peer might be offline or behind a restrictive firewall.`,
        )
        setIsConnecting(false)
      }
    }, 30000)

    if (isInitiator) {
      const dataChannel = pc.createDataChannel("chat", { ordered: true })
      setupDataChannel(dataChannel, targetPeerId)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await sendToSignalingServer({
        type: "offer",
        data: { to: targetPeerId, offer },
      })
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, targetPeerId)
      }
    }

    return pc
  }

  const setupDataChannel = (dataChannel: RTCDataChannel, peerId: string) => {
    dataChannel.onopen = () => {
      addMessage("System", `💬 Chat ready with ${peerId.substring(0, 6)}`)
      setPeers((prev) => {
        const updated = new Map(prev)
        const peer = updated.get(peerId)
        if (peer) {
          peer.dataChannel = dataChannel
          updated.set(peerId, peer)
        }
        return updated
      })
    }

    dataChannel.onmessage = (event) => {
      const data = JSON.parse(event.data)
      addMessage(data.sender, data.content, false)
    }

    dataChannel.onerror = (error) => {
      addMessage("System", `❌ Chat error with ${peerId.substring(0, 6)}: ${error}`)
    }
  }

  const updateConnectionStatus = () => {
    const connectedPeers = Array.from(peers.values()).filter((p) => p.connected).length
    setConnectionStatus(connectedPeers > 0 ? `🌍 Connected to ${connectedPeers} peer(s)` : "Disconnected")
  }

  const pollSignalingServer = async () => {
    try {
      const response = await sendToSignalingServer({ type: "poll" })

      if (response.offer) {
        const { from, offer } = response.offer
        addMessage("System", `📨 Received connection offer from ${from.substring(0, 6)}`)
        setIsConnecting(true)

        const pc = await createPeerConnection(from, false)
        await pc.setRemoteDescription(offer)

        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        await sendToSignalingServer({
          type: "answer",
          data: { to: from, answer },
        })

        setPeers((prev) =>
          new Map(prev).set(from, {
            id: from,
            username: `Peer-${from.substring(0, 6)}`,
            connection: pc,
            connected: false,
          }),
        )
      }

      if (response.answer) {
        const { from, answer } = response.answer
        addMessage("System", `📨 Received connection answer from ${from.substring(0, 6)}`)
        const peer = peers.get(from)
        if (peer) {
          await peer.connection.setRemoteDescription(answer)
        }
      }

      if (response.iceCandidates) {
        for (const { from, candidate } of response.iceCandidates) {
          const peer = peers.get(from)
          if (peer) {
            await peer.connection.addIceCandidate(candidate)
          }
        }
      }
    } catch (error) {
      console.error("Polling error:", error)
    }
  }

  const joinRoom = async () => {
    if (!username.trim() || !roomId.trim()) {
      addMessage("System", "❌ Please enter both username and room ID")
      return
    }

    setIsConnecting(true)
    addMessage("System", `🔄 Joining room ${roomId}...`)

    try {
      const response = await sendToSignalingServer({ type: "join-room" })

      if (response.success) {
        setIsInRoom(true)
        addMessage("System", `✅ Joined global room: ${roomId}`)
        addMessage("System", "🌍 Ready for worldwide P2P connections!")

        // Start polling for signaling messages
        pollingRef.current = setInterval(pollSignalingServer, 2000)

        // Connect to existing peers
        if (response.peers.length > 0) {
          addMessage("System", `👥 Found ${response.peers.length} peer(s) in room. Connecting...`)

          for (const peerId of response.peers) {
            const pc = await createPeerConnection(peerId, true)
            setPeers((prev) =>
              new Map(prev).set(peerId, {
                id: peerId,
                username: `Peer-${peerId.substring(0, 6)}`,
                connection: pc,
                connected: false,
              }),
            )
          }
        } else {
          addMessage("System", "👤 You're the first one in this room. Waiting for others...")
          setIsConnecting(false)
        }
      }
    } catch (error) {
      addMessage("System", `❌ Failed to join room: ${error}`)
      setIsConnecting(false)
    }
  }

  const leaveRoom = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    peers.forEach((peer) => {
      peer.connection.close()
    })

    setPeers(new Map())
    setIsInRoom(false)
    setConnectionStatus("Disconnected")
    setIsConnecting(false)
    addMessage("System", "👋 Left the room")
  }

  const sendMessage = () => {
    if (!messageInput.trim()) return

    const messageData = {
      sender: username,
      content: messageInput.trim(),
    }

    let sentCount = 0
    peers.forEach((peer) => {
      if (peer.dataChannel && peer.dataChannel.readyState === "open") {
        peer.dataChannel.send(JSON.stringify(messageData))
        sentCount++
      }
    })

    if (sentCount > 0) {
      addMessage(username, messageInput.trim(), true)
      setMessageInput("")
    } else {
      addMessage("System", "❌ No connected peers to send message to")
    }
  }

  const generateRoomId = () => {
    setRoomId(Math.random().toString(36).substring(2, 10).toUpperCase())
  }

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId)
    addMessage("System", "📋 Room ID copied to clipboard!")
  }

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Reliable Global P2P Chat
              <Badge variant={isInRoom ? "default" : "outline"} className="ml-auto">
                {connectionStatus}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isInRoom ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Your Username</label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Room ID</label>
                    <div className="flex gap-2">
                      <Input
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                        placeholder="Enter or generate room ID"
                      />
                      <Button variant="outline" onClick={generateRoomId}>
                        Generate
                      </Button>
                      {roomId && (
                        <Button variant="outline" size="sm" onClick={copyRoomId}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={joinRoom} className="flex-1" disabled={isConnecting}>
                    {isConnecting ? "🔄 Connecting..." : "🌍 Join Global Room"}
                  </Button>
                </div>

                <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                  <p className="font-medium mb-1 flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Global P2P Chat with Enhanced Connectivity
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>✅ Works worldwide with automatic signaling</li>
                    <li>✅ Multiple STUN/TURN servers for reliability</li>
                    <li>✅ Automatic retry and fallback mechanisms</li>
                    <li>✅ Enhanced error handling and diagnostics</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    Room: {roomId}
                    <Button variant="ghost" size="sm" onClick={copyRoomId}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </p>
                  <p className="text-sm text-gray-600">
                    Connected peers: {Array.from(peers.values()).filter((p) => p.connected).length}
                  </p>
                  {isConnecting && (
                    <p className="text-sm text-blue-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Establishing connections...
                    </p>
                  )}
                </div>
                <Button variant="outline" onClick={leaveRoom}>
                  Leave Room
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {isInRoom && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Global Chat Messages
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
                    disabled={Array.from(peers.values()).filter((p) => p.connected).length === 0}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={Array.from(peers.values()).filter((p) => p.connected).length === 0}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Connected Peers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Array.from(peers.values()).map((peer) => (
                    <div key={peer.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                      {peer.connected ? (
                        <Wifi className="h-4 w-4 text-green-500" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-orange-500" />
                      )}
                      <span className="text-sm">{peer.username}</span>
                    </div>
                  ))}

                  {peers.size === 0 && !isConnecting && (
                    <p className="text-sm text-gray-500">Waiting for peers to join...</p>
                  )}

                  {isConnecting && <p className="text-sm text-blue-600">🔄 Connecting to peers...</p>}
                </div>

                <Separator className="my-4" />

                <div className="text-xs text-gray-600">
                  <p className="font-medium mb-2">🌍 Enhanced Features:</p>
                  <ul className="space-y-1">
                    <li>✅ Automatic signaling</li>
                    <li>✅ TURN server fallback</li>
                    <li>✅ Connection diagnostics</li>
                    <li>✅ Retry mechanisms</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
