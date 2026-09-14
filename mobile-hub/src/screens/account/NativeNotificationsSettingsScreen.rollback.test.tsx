
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CHAT_NOTIFICATION_CHANNEL_LABELS } from '../../account/accountConstants';
import * as api from '../../api/notificationApi';
import { NativeNotificationsSettingsScreen } from './NativeNotificationsSettingsScreen';
let mockOffline=false;
const mockExecute=jest.fn(async()=>({status:'registered'}));
jest.mock('../../auth/AuthContext',()=>({useAuth:()=>({offlineMode:mockOffline})}));
jest.mock('../../preferences/PreferencesContext',()=>({usePreferences:()=>({preferences:{theme_mode:'dark'}})}));
jest.mock('../../native/useNativeCommands',()=>({useNativeCommands:()=>({execute:mockExecute})}));
jest.mock('../../api/notificationApi',()=>({getNotificationPreferences:jest.fn(),updateNotificationPreferences:jest.fn()}));
beforeEach(()=>{jest.clearAllMocks();mockOffline=false;(api.getNotificationPreferences as jest.Mock).mockResolvedValue({channels:{mail:true}});});
it('rolls the displayed channel back when the update fails',async()=>{
 let fail!: (cause:Error)=>void;
 (api.updateNotificationPreferences as jest.Mock).mockReturnValue(new Promise((_resolve,reject)=>{fail=reject;}));
 const view=await render(<NativeNotificationsSettingsScreen/>);
 const mail=()=>view.getAllByRole('switch')[1+CHAT_NOTIFICATION_CHANNEL_LABELS.length];
 await waitFor(()=>expect(mail().props.value).toBe(true));
 await fireEvent(mail(),'valueChange',false);
 expect(mail().props.value).toBe(false);
 expect(api.updateNotificationPreferences).toHaveBeenCalledWith({mail:false});
 await act(async()=>fail(new Error('offline transport')));
 await waitFor(()=>expect(mail().props.value).toBe(true));
 await view.unmount();
});
it('does not load or update server preferences while offline',async()=>{
 mockOffline=true;
 const view=await render(<NativeNotificationsSettingsScreen/>);
 const mail=()=>view.getAllByRole('switch')[1+CHAT_NOTIFICATION_CHANNEL_LABELS.length];
 await waitFor(()=>expect(mail().props.disabled).toBe(true));
 await fireEvent(mail(),'valueChange',false);
 expect(api.getNotificationPreferences).not.toHaveBeenCalled();
 expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
 await view.unmount();
});
