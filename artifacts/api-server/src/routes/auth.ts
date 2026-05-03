/**
 * Auth Router — Clerk-backed
 *
 * Clerk handles all sign-in/sign-up flows on the frontend.
 * This router only exposes /api/auth/me to return the authenticated
 * user's profile so the frontend can populate the sidebar.
 */
import { Router } from "express";
import { getAuth, createClerkClient } from "@clerk/express";

const router = Router();

router.get("/auth/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const user = await client.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress ?? "";
    res.json({
      id: userId,
      username: email.split("@")[0] || user.firstName || userId,
      email,
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || email,
      imageUrl: user.imageUrl,
    });
  } catch {
    res.status(401).json({ error: "Not authenticated." });
  }
});

export default router;
