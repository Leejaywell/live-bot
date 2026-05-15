import { createContext, useContext } from 'react';
import { UserInfo } from '../lib/api';

export interface LoginContextType {
  isLoggedIn: boolean;
  setIsLoggedIn: (v: boolean) => void;
  userInfo: UserInfo | null;
  setUserInfo: (info: UserInfo | null) => void;
  loginChecked: boolean;
  refreshUserInfo: () => Promise<UserInfo | null>;
  openLoginModal: () => void;
}

export const LoginContext = createContext<LoginContextType | undefined>(undefined);

export function useLogin() {
  const context = useContext(LoginContext);
  if (context === undefined) {
    throw new Error('useLogin must be used within a LoginContext.Provider');
  }
  return context;
}

// 兼容旧版 Hook
export const useLoggedIn = () => {
  const ctx = useContext(LoginContext);
  return ctx?.isLoggedIn ?? false;
};
