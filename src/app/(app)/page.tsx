import TodoList from '@/components/todo-list';

export default function TodayPage() {
  const today = new Date().toISOString().split('T')[0];
  return <TodoList date={today} label="Today" />;
}
