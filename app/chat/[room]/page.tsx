import Client from '../Client';

export default function RoomPage({ params }: { params: { room: string } }) {
  return <Client initialRoom={decodeURIComponent(params.room)} />;
}
