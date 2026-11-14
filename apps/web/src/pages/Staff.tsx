import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLE_DESCRIPTIONS, ROLES, type Role } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'invited' | 'active' | 'revoked';
  created_at: string;
}

const STATUS_LABELS: Record<Member['status'], string> = {
  invited: 'Invited (has not signed in yet)',
  active: 'Active',
  revoked: 'Access removed',
};

export function Staff() {
  const { me, apiFetch } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [inviteMsg, setInviteMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/members');
    if (res.ok) {
      setMembers(((await res.json()) as { members: Member[] }).members);
      setLoadError(null);
    } else setLoadError(await readError(res));
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setInviteMsg(null);
    const res = await apiFetch('/api/admin/invitations', { method: 'POST', body: { email, name, role } });
    if (res.ok) {
      setInviteMsg({ kind: 'success', text: `Invitation sent to ${email}.` });
      setEmail('');
      setName('');
      await load();
    } else setInviteMsg({ kind: 'error', text: await readError(res) });
    setBusy(false);
  }

  async function revoke(id: string) {
    const res = await apiFetch(`/api/admin/members/${id}/revoke`, { method: 'POST', body: { reason } });
    if (res.ok) {
      setRevoking(null);
      setReason('');
      await load();
    } else alert(await readError(res));
  }

  const canInvite = me?.capabilities.includes('users.invite');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Staff access</h1>

      {canInvite && (
        <Card title="Invite someone">
          <form onSubmit={invite} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Name
                <input className={inputClass} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">
                Email
                <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">What should they be able to do?</legend>
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer gap-3 rounded-md border border-stone-200 p-3 hover:bg-stone-50">
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                    <span>
                      <span className="font-medium capitalize">{r}</span>
                      <span className="block text-sm text-stone-600">{ROLE_DESCRIPTIONS[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {inviteMsg && <Alert kind={inviteMsg.kind}>{inviteMsg.text}</Alert>}
            <button className={buttonClass} disabled={busy}>
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
        </Card>
      )}

      <Card title="People with access">
        {loadError && <Alert kind="error">{loadError}</Alert>}
        {!members && !loadError && <p className="text-sm text-stone-500">Loading…</p>}
        {members && (
          <ul className="divide-y divide-stone-200">
            {members.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-sm text-stone-600">{m.email}</span>
                  <span className="text-sm capitalize">{m.role}</span>
                  <span className={`text-sm ${m.status === 'revoked' ? 'text-red-700' : 'text-stone-600'}`}>{STATUS_LABELS[m.status]}</span>
                  {m.status !== 'revoked' && revoking !== m.id && (
                    <button className={`${secondaryButtonClass} ml-auto`} onClick={() => setRevoking(m.id)}>
                      Remove access
                    </button>
                  )}
                </div>
                {revoking === m.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-stone-50 p-3">
                    <label className="block grow text-sm font-medium">
                      Reason (kept in the activity history)
                      <input className={inputClass} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <button className={buttonClass} disabled={!reason.trim()} onClick={() => void revoke(m.id)}>
                      Confirm removal
                    </button>
                    <button className={secondaryButtonClass} onClick={() => setRevoking(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
