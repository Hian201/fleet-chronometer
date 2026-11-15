// 正式任務分區的離線互動預覽，使用模擬進度及記憶體偏好。
import { GameState } from '../../utils/state';
import { QUEST_CATALOG_BY_NO } from '../../utils/quest-flow';
import { setLang } from '../../utils/ui-i18n';
import { questFlowSection } from '../../entrypoints/overview/sections/quest-flow';
setLang((window as any).previewLang);
const state = new GameState();
state.applyEvent('api_get_member/questlist', { api_list: [201,214,216,261,613,637,893,944,1042,101,303].map((no,i)=>({ api_no:no, api_state:i<2?2:no===303?3:1, api_title:QUEST_CATALOG_BY_NO.get(no)!.name, api_detail:QUEST_CATALOG_BY_NO.get(no)!.detail })) }, {api_tab_id:'0'});
// 預覽偏好只存記憶體，避免碰到使用者原有設定。
const memory = new Map<string,string>();
Object.defineProperty(window,'localStorage',{value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
async function main(){
const host=document.getElementById('host')!;
await questFlowSection.render(host,{state,rerender(){},async reloadState(){}});
(host.querySelector('.qf-more') as HTMLDetailsElement).open=true;
}
void main();
