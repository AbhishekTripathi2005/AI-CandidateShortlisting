const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");

const dns = require('dns').promises;   // or just require('dns') in older Node
dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ====================== MONGOOSE SCHEMA ======================
const CandidateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  skills: { type: [String], required: true },
  experience: { type: Number, required: true },
  bio: { type: String, default: "" }
}, { timestamps: true });

const Candidate = mongoose.model("Candidate", CandidateSchema);

// ====================== MONGODB CONNECTION ======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ====================== ROUTES ======================

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Candidate Shortlisting System is Running" });
});

// ====================== CANDIDATE ROUTES ======================

// 1. Add New Candidate
app.post("/api/candidates", async (req, res) => {
  try {
    const { name, email, skills, experience, bio } = req.body;

    const candidate = new Candidate({ name, email, skills, experience, bio });
    await candidate.save();

    res.status(201).json({
      message: "Candidate added successfully",
      candidate
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 2. Get All Candidates
app.get("/api/candidates", async (req, res) => {
  try {
    const candidates = await Candidate.find().sort({ createdAt: -1 });
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====================== MATCHING ROUTES ======================

// 3. Basic Matching
app.post("/api/match", async (req, res) => {
  try {
    const { requiredSkills, minExperience = 0 } = req.body;

    const candidates = await Candidate.find();

    const result = candidates.map(candidate => {
      const matchedSkills = candidate.skills.filter(skill =>
        requiredSkills.includes(skill)
      );

      const matchPercentage = requiredSkills.length > 0
        ? Math.round((matchedSkills.length / requiredSkills.length) * 100)
        : 0;

      const experienceMatch = candidate.experience >= minExperience;

      let finalScore = matchPercentage;
      if (!experienceMatch) finalScore = Math.floor(finalScore * 0.6);

      return {
        ...candidate.toObject(),
        matchScore: finalScore,
        matchedSkills,
        experienceMatch
      };
    });

    result.sort((a, b) => b.matchScore - a.matchScore);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. AI Based Smart Shortlisting (OpenRouter)
app.post("/api/ai/shortlist", async (req, res) => {
  try {
    const { requiredSkills, minExperience = 0, preferredSkills = [] } = req.body;

    const candidates = await Candidate.find();

    if (candidates.length === 0) {
      return res.json({ message: "No candidates found" });
    }

    const candidatesText = candidates.map((c, i) =>
      `${i + 1}. ${c.name} (${c.experience} years exp) - Skills: ${c.skills.join(", ")}`
    ).join("\n");

    const prompt = `
You are an expert technical recruiter.

**Job Requirements:**
- Required Skills: ${requiredSkills.join(", ")}
- Minimum Experience: ${minExperience} years
${preferredSkills.length ? `- Preferred Skills: ${preferredSkills.join(", ")}` : ''}

**Available Candidates:**
${candidatesText}

Analyze and rank the candidates. Return **only valid JSON** in this format:

{
  "rankedCandidates": [
    {
      "rank": 1,
      "name": "Candidate Name",
      "matchScore": 92,
      "reason": "Very detailed explanation why this candidate is best fit..."
    }
  ]
}
`;

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      }),
    });

    const data = await aiResponse.json();
    let content = data.choices[0].message.content;

    // Clean JSON
    content = content.replace(/```json|```/g, '').trim();

    const parsedAI = JSON.parse(content);

    res.json({
      success: true,
      aiRanking: parsedAI.rankedCandidates,
      totalCandidates: candidates.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "AI Shortlisting Failed",
      message: error.message
    });
  }
});

// ====================== SERVER START ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});