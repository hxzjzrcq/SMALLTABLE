import { useState } from 'react';
import type { SmalltableClient } from '../controller';
export function PasswordSettings({
  actions,
  connected,
}: {
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [values, setValues] = useState({
    currentDMPassword: '',
    roomPassword: '',
    roomConfirm: '',
    dmPassword: '',
    dmConfirm: '',
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !connected) return;
    if (!values.roomPassword && !values.dmPassword) {
      setMessage('请填写至少一个新密码');
      return;
    }
    if (values.roomPassword !== values.roomConfirm || values.dmPassword !== values.dmConfirm) {
      setMessage('两次输入的新密码不一致');
      return;
    }
    if (values.roomPassword && !confirm('修改房间口令将使所有人掉线，包括你自己。继续？')) return;
    setBusy(true);
    setMessage('正在保存…');
    try {
      await actions.changePasswords({
        currentDMPassword: values.currentDMPassword,
        ...(values.roomPassword ? { roomPassword: values.roomPassword } : {}),
        ...(values.dmPassword ? { dmPassword: values.dmPassword } : {}),
      });
      setMessage('密码已保存，请重新进入或解锁');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setValues({
        currentDMPassword: '',
        roomPassword: '',
        roomConfirm: '',
        dmPassword: '',
        dmConfirm: '',
      });
      setBusy(false);
    }
  }
  return (
    <details className="password-settings">
      <summary>密码管理</summary>
      <p className="hint">
        新密码 8–128
        字符，包含大写、小写、数字、特殊符号中至少两类；不能含空白或使用常见弱密码。两种密码不能相同。
      </p>
      <p className="hint">
        留空表示不修改该项。修改房间口令会使所有人掉线；仅修改 DM 密码会撤销所有 DM 授权。
      </p>
      <form onSubmit={(e) => void submit(e)}>
        {(
          [
            ['currentDMPassword', '当前 DM 密码', 'current-password'],
            ['roomPassword', '新房间口令', 'new-password'],
            ['roomConfirm', '确认新房间口令', 'new-password'],
            ['dmPassword', '新 DM 密码', 'new-password'],
            ['dmConfirm', '确认新 DM 密码', 'new-password'],
          ] as const
        ).map(([key, label, autocomplete]) => (
          <label key={key}>
            {label}
            <input
              type="password"
              autoComplete={autocomplete}
              required={key === 'currentDMPassword'}
              maxLength={key === 'currentDMPassword' ? 1024 : 256}
              value={values[key]}
              disabled={busy || !connected}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
        <button disabled={busy || !connected}>保存密码</button>
        {message && (
          <p role="status" className="hint">
            {message}
          </p>
        )}
      </form>
    </details>
  );
}
