package dk.rasmusgunnar.familiekalender;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState) {
  registerPlugin(DeviceScreenPlugin.class);
  super.onCreate(savedInstanceState);
 }
}
