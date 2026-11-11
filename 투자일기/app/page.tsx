import { currentUser } from './auth';
import JournalApp from './journal-app';
import AuthUI from './auth-ui';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await currentUser();
  return <><JournalApp user={user ? {id:user.id,name:user.name,email:user.email} : null} /><AuthUI/></>;
}
