import { useState, useEffect } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Toggle } from '../components/Toggle';
import { IconButton } from '../components/IconButton';
import { Send, X, Plus, MessageSquare, Info, Bot, Sparkles, MessageCircle } from 'lucide-react';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

export function AI() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [testMessages, setTestMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [inputMessage, setInputMessage] = useState('');

  useEffect(() => {
    api.loadConfig().then(setConfig).catch(console.error);
  }, []);

  const handleSaveConfig = async () => {
    if (!config) return;
    try {
      await api.saveConfig(config);
      toast.success('配置已保存');
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    setTestMessages([...testMessages, { role: 'user', content: inputMessage }]);
    setInputMessage('');
    setTimeout(() => {
      setTestMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '这是 AI 的回复示例。目前对话测试仅限前端展示，实际回复请在直播间发送指令触发。' },
      ]);
    }, 1000);
  };

  if (!config) return <div className="p-4">加载中...</div>;

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      {/* 顶部配置面板 */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[13px] font-semibold">AI 模型配置</h2>
            <div className="relative group">
              <Info className="w-3 h-3 text-gray-400 cursor-help" />
              <div className="absolute left-0 top-5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-2 py-1 rounded text-[10px] whitespace-nowrap z-10">
                当前仅支持单模型配置
              </div>
            </div>
          </div>

          <div className="flex-1" />
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">响应模式</span>
              <select 
                className="h-8 px-2 rounded bg-white/20 border border-white/10 text-[11px]"
                value={config.RobotMode}
                onChange={(e) => setConfig({ ...config, RobotMode: e.target.value })}
              >
                <option value="ChatGPT">ChatGPT</option>
                <option value="QingYunKe">青云客 (免费)</option>
                <option value="None">禁用</option>
              </select>
            </div>
            <Button size="sm" variant="primary" onClick={handleSaveConfig}>保存设置</Button>
          </div>
        </div>
      </GlassCard>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* 配置栏 */}
        <GlassCard className="w-80 p-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <label className="text-[11px] text-gray-500 mb-1.5 block">机器人名称</label>
            <Input
              value={config.RobotName}
              onChange={(e) => setConfig({ ...config, RobotName: e.target.value })}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1.5 block">呼叫指令</label>
            <Input
              value={config.TalkRobotCmd}
              onChange={(e) => setConfig({ ...config, TalkRobotCmd: e.target.value })}
              className="w-full"
            />
          </div>

          <div className="pt-2 border-t border-white/10">
            <h3 className="text-[12px] font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> ChatGPT 设置
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">API URL</label>
                <Input
                  mono
                  value={config.ChatGPT.APIUrl}
                  onChange={(e) => setConfig({ ...config, ChatGPT: { ...config.ChatGPT, APIUrl: e.target.value } })}
                  className="w-full text-[10px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">API Token</label>
                <Input
                  type="password"
                  value={config.ChatGPT.APIToken}
                  onChange={(e) => setConfig({ ...config, ChatGPT: { ...config.ChatGPT, APIToken: e.target.value } })}
                  className="w-full text-[10px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">模型</label>
                <Input
                  value={config.ChatGPT.Model}
                  onChange={(e) => setConfig({ ...config, ChatGPT: { ...config.ChatGPT, Model: e.target.value } })}
                  className="w-full text-[11px]"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">限制频率</span>
                <Toggle
                  checked={config.ChatGPT.Limit}
                  onChange={(checked) => setConfig({ ...config, ChatGPT: { ...config.ChatGPT, Limit: checked } })}
                />
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 对话和提示词 */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <GlassCard className="h-1/2 flex flex-col p-5 overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-4 h-4 text-purple-500" />
              <h2 className="text-[13px] font-semibold">角色人设 (System Prompt)</h2>
            </div>
            <TextArea
              value={config.ChatGPT.Prompt}
              onChange={(e) => setConfig({ ...config, ChatGPT: { ...config.ChatGPT, Prompt: e.target.value } })}
              className="flex-1 resize-none text-[12px]"
            />
          </GlassCard>

          <GlassCard className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h2 className="text-[13px] font-semibold">本地测试</h2>
              <Button size="sm" variant="ghost" onClick={() => setTestMessages([])}>清空</Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {testMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-[11px] italic">
                  在下方输入消息测试机器人人设
                </div>
              ) : (
                testMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-2.5 rounded-xl text-[12px] ${
                      msg.role === 'user' ? 'bg-[var(--primary-color)] text-white' : 'bg-white/20'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-white/10 flex gap-2">
              <Input
                placeholder="测试消息..."
                className="flex-1"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <IconButton onClick={handleSendMessage}>
                <Send className="w-4 h-4" />
              </IconButton>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
