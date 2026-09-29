package dk.rasmusgunnar.familiekalender;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
@CapacitorPlugin(name="DeviceScreen")
public class DeviceScreenPlugin extends Plugin {
 private boolean requestedAwake=false;
 @PluginMethod public void setAwake(PluginCall call) {
  boolean enabled=call.getBoolean("enabled",false);
  getActivity().runOnUiThread(()->{
   requestedAwake=enabled;
   if(enabled)getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
   else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
   call.resolve();
  });
 }
 @Override protected void handleOnResume() {
  getActivity().runOnUiThread(()->{if(requestedAwake)getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);});
 }
 @Override protected void handleOnPause() {
  getActivity().runOnUiThread(()->getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
 }
}
