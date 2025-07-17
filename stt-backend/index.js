/**
 * Simple HTTP API server for generating Speechmatics JWT tokens
 * Clients use these tokens to connect directly to Speechmatics real-time API
 */
import express from "express"
import cors from "cors"
import { createSpeechmaticsJWT } from "@speechmatics/auth"
import dotenv from "dotenv"

dotenv.config()

const app = express()
const apiKey = process.env.API_KEY

if (!apiKey) {
	throw new Error("Please set the API_KEY environment variable")
}

const PORT = process.env.PORT || 8080

// Middleware
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: Date.now() })
})

// Generate JWT token for Speechmatics real-time API
app.post("/api/token", async (req, res) => {
	try {
		const { ttl = 3600 } = req.body // Default 1 hour

		// Create JWT for real-time transcription
		const jwt = await createSpeechmaticsJWT({
			type: "rt", // real-time
			apiKey,
			ttl,
		})

		res.json({
			success: true,
			token: jwt,
			expiresIn: ttl,
			timestamp: Date.now(),
		})

		console.log(`JWT token generated, expires in ${ttl} seconds`)
	} catch (error) {
		console.error("Error generating JWT:", error)
		res.status(500).json({
			success: false,
			error: "Failed to generate authentication token",
			timestamp: Date.now(),
		})
	}
})

// Start server
app.listen(PORT, () => {
	console.log(`JWT API server running on port ${PORT}`)
	console.log(`Health check: http://localhost:${PORT}/health`)
	console.log(`Token endpoint: http://localhost:${PORT}/api/token`)
})

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("Shutting down JWT API server...")
	process.exit(0)
})
