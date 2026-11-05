import { useCampaign, useCampaigns } from "./live.ts";
import { useRoute } from "./route.ts";
import { selectionOf, Shell } from "./shell.tsx";

/*
 * The page's data: the campaign list and the selected campaign, both polled. The panes and the
 * inspector read their own details through the hooks of `live.ts`.
 */

export default function App() {
  const navigation = useRoute();
  const campaigns = useCampaigns();
  const { campaign: key } = selectionOf(campaigns.data, navigation.route);
  const reading = useCampaign(key);
  return <Shell navigation={navigation} campaigns={campaigns} reading={reading} />;
}
