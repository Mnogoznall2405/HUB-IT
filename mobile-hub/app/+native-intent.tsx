import {
  rememberSystemIntentDestination,
  routeSystemIntentPath,
} from '../src/navigation/systemIntent';

export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const destination = routeSystemIntentPath(path);
  rememberSystemIntentDestination(destination);
  return destination;
}
