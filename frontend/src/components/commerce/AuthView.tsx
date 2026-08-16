import { useState } from 'react';
import { AlertTriangle, Loader2, LogIn, UserPlus } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

export default function AuthView({ language }: { language: SiteLanguage }) {
  const login = useCommerceStore(s => s.login);
  const register = useCommerceStore(s => s.register);
  const clearError = useCommerceStore(s => s.clearError);
  const isBusy = useCommerceStore(s => s.isBusy);
  const error = useCommerceStore(s => s.error);
  const zh = language === 'zh';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    clearError();
  };

  const submit = async () => {
    if (mode === 'login') {
      await login(account.trim(), password);
      return;
    }
    await register(email.trim(), password, displayName.trim());
  };

  const canSubmit = mode === 'login'
    ? Boolean(account.trim() && password)
    : Boolean(email.trim() && password.length >= 8);

  return (
    <div id="auth" className="coach-card p-5">
      <div className="auth-tabs" role="tablist">
        <button type="button" className={`auth-tab ${mode === 'login' ? 'auth-tab-active' : ''}`} onClick={() => switchMode('login')}>
          {zh ? '登录' : 'Sign in'}
        </button>
        <button type="button" className={`auth-tab ${mode === 'register' ? 'auth-tab-active' : ''}`} onClick={() => switchMode('register')}>
          {zh ? '注册' : 'Register'}
        </button>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (!isBusy && canSubmit) void submit();
        }}
      >
        {mode === 'login' ? (
          <div>
            <label className="coach-label" htmlFor="account">{zh ? '账号' : 'Account'}</label>
            <input id="account" className="coach-input" value={account} onChange={event => setAccount(event.target.value)} autoComplete="username" autoFocus />
          </div>
        ) : (
          <>
            <div>
              <label className="coach-label" htmlFor="email">{zh ? '邮箱' : 'Email'}</label>
              <input id="email" className="coach-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" />
            </div>
            <div>
              <label className="coach-label" htmlFor="displayName">{zh ? '称呼' : 'Name'}</label>
              <input id="displayName" className="coach-input" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} />
            </div>
          </>
        )}

        <div>
          <label className="coach-label" htmlFor="password">{zh ? '密码' : 'Password'}</label>
          <input
            id="password"
            className="coach-input"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        <button className="coach-primary-button w-full" type="submit" disabled={isBusy || !canSubmit}>
          {isBusy ? <Loader2 size={15} className="animate-spin" /> : mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
          {mode === 'login' ? (zh ? '登录' : 'Sign in') : (zh ? '创建账号' : 'Create account')}
        </button>
      </form>

      {error && (
        <p className="mt-4 flex items-start gap-2 text-sm text-[var(--june-danger)]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
