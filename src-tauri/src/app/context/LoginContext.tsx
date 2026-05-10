import { createContext, useContext } from 'react';

export const LoginContext = createContext<boolean>(false);
export const useLoggedIn = () => useContext(LoginContext);
