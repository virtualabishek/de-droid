/**
 * Auth Store
 * Manages local authentication state using Zustand
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

export interface AuthResult {
  success: boolean;
  message: string;
  user?: User;
  requiresVerification?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  pendingVerificationEmail: string | null;

  // Actions
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (
    email: string,
    password: string,
    name?: string,
  ) => Promise<AuthResult>;
  verifyEmail: (email: string, otp: string) => Promise<AuthResult>;
  resendOtp: (email: string) => Promise<AuthResult>;
  logout: () => void;
  checkSession: () => Promise<void>;
  updateProfile: (data: { name?: string }) => Promise<AuthResult>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      pendingVerificationEmail: null,

      login: async (email: string, password: string) => {
        try {
          const result = await window.electronAPI.auth.login(email, password);

          if (result.success && result.user) {
            set({
              user: result.user,
              isAuthenticated: true,
              pendingVerificationEmail: null,
            });
          } else if (result.requiresVerification) {
            set({ pendingVerificationEmail: email });
          }

          return result;
        } catch (error) {
          console.error("[AuthStore] Login error:", error);
          return {
            success: false,
            message: error instanceof Error ? error.message : "Login failed",
          };
        }
      },

      register: async (email: string, password: string, name?: string) => {
        try {
          const result = await window.electronAPI.auth.register(
            email,
            password,
            name,
          );

          if (result.success && result.user && !result.requiresVerification) {
            set({
              user: result.user,
              isAuthenticated: true,
              pendingVerificationEmail: null,
            });
          } else if (result.success && result.requiresVerification) {
            set({ pendingVerificationEmail: email });
          }

          return result;
        } catch (error) {
          console.error("[AuthStore] Register error:", error);
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Registration failed",
          };
        }
      },

      verifyEmail: async (email: string, otp: string) => {
        try {
          const result = await window.electronAPI.auth.verifyEmail(email, otp);

          if (result.success && result.user) {
            set({
              user: result.user,
              isAuthenticated: true,
              pendingVerificationEmail: null,
            });
          }

          return result;
        } catch (error) {
          console.error("[AuthStore] Verify error:", error);
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Verification failed",
          };
        }
      },

      resendOtp: async (email: string) => {
        try {
          return await window.electronAPI.auth.resendOtp(email);
        } catch (error) {
          console.error("[AuthStore] Resend OTP error:", error);
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to resend code",
          };
        }
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          pendingVerificationEmail: null,
        });
      },

      checkSession: async () => {
        const { user } = get();

        if (user?.id) {
          try {
            const userData = await window.electronAPI.auth.getUser(user.id);
            if (userData) {
              set({
                user: userData,
                isAuthenticated: true,
                isLoading: false,
              });
              return;
            }
          } catch (error) {
            console.error("[AuthStore] Session check error:", error);
          }
        }

        set({ isLoading: false });
      },

      updateProfile: async (data: { name?: string }) => {
        const { user } = get();

        if (!user) {
          return { success: false, message: "Not logged in" };
        }

        try {
          const result = await window.electronAPI.auth.updateProfile(
            user.id,
            data,
          );

          if (result.success && result.user) {
            set({ user: result.user });
          }

          return result;
        } catch (error) {
          console.error("[AuthStore] Update profile error:", error);
          return {
            success: false,
            message: error instanceof Error ? error.message : "Update failed",
          };
        }
      },
    }),
    {
      name: "dedroid-auth",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
