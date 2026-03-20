/**
 * Login Page
 * Local authentication with email/password and OTP verification
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function Login() {
  const navigate = useNavigate();
  const { login, verifyEmail, resendOtp, pendingVerificationEmail } =
    useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      const result = await login(email, password);

      if (result.success) {
        navigate("/");
      } else if (result.requiresVerification) {
        setVerifyingEmail(email);
        setShowVerification(true);
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      const result = await verifyEmail(verifyingEmail, otp);

      if (result.success) {
        navigate("/");
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError("Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError("");
    setMessage("");

    try {
      const result = await resendOtp(verifyingEmail);
      if (result.success) {
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError("Failed to resend code");
    }
  };

  // Check if we have a pending verification from registration
  useState(() => {
    if (pendingVerificationEmail) {
      setVerifyingEmail(pendingVerificationEmail);
      setShowVerification(true);
    }
  });

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-600 mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">De-Droid</h1>
          <p className="text-gray-400 mt-1">Android Debloater</p>
        </div>

        {/* Card */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          {!showVerification ? (
            <>
              <h2 className="text-xl font-semibold mb-6">Sign In</h2>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-400 text-sm">
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-medium transition-colors"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </button>
              </form>

              <p className="mt-6 text-center text-gray-400">
                Don&apos;t have an account?{" "}
                <Link
                  to="/register"
                  className="text-primary-400 hover:text-primary-300"
                >
                  Create one
                </Link>
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-2">Verify Your Email</h2>
              <p className="text-gray-400 text-sm mb-6">
                Enter the verification code for{" "}
                <strong>{verifyingEmail}</strong>
              </p>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-center text-2xl tracking-widest font-mono placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-medium transition-colors"
                >
                  {isLoading ? "Verifying..." : "Verify Email"}
                </button>
              </form>

              <div className="mt-4 text-center">
                <button
                  onClick={handleResendOtp}
                  className="text-primary-400 hover:text-primary-300 text-sm"
                >
                  Resend verification code
                </button>
              </div>

              <button
                onClick={() => {
                  setShowVerification(false);
                  setOtp("");
                  setError("");
                  setMessage("");
                }}
                className="mt-4 w-full text-gray-400 hover:text-gray-300 text-sm"
              >
                ← Back to login
              </button>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-gray-500 text-sm">
          Your data is stored locally on this device
        </p>
      </div>
    </div>
  );
}
