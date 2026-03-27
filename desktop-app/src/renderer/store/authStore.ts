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
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (
    email: string,
    password: string,
    name?: string,
  ) => Promise<AuthResult>;
  logout: () => void;
  checkSession: () => Promise<void>;
  updateProfile: (data: { name?: string }) => Promise<AuthResult>;
}

function getAuthBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  const authApi = window.electronAPI?.auth;
  if (!authApi) {
    return null;
  }

  return authApi;
}

function missingBridgeResult(): AuthResult {
  return {
    success: false,
    message:
      "Desktop bridge not available. Please run the app via Electron (not browser-only), then restart the app.",
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (email: string, password: string) => {
        const authApi = getAuthBridge();
        if (!authApi) {
          return missingBridgeResult();
        }

        try {
          const result = await authApi.login(email, password);

          if (result.success && result.user) {
            set({
              user: result.user,
              isAuthenticated: true,
            });
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
        const authApi = getAuthBridge();
        if (!authApi) {
          return missingBridgeResult();
        }

        try {
          const result = await authApi.register(
            email,
            password,
            name,
          );

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

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
        });
      },

      checkSession: async () => {
        const { user } = get();
        const authApi = getAuthBridge();

        if (!authApi) {
          set({ isLoading: false });
          return;
        }

        if (user?.id) {
          try {
            const userData = await authApi.getUser(user.id);
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
        const authApi = getAuthBridge();

        if (!authApi) {
          return missingBridgeResult();
        }

        if (!user) {
          return { success: false, message: "Not logged in" };
        }

        try {
          const result = await authApi.updateProfile(
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
