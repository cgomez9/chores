import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RejectModal } from '../src/components/RejectModal';

describe('RejectModal', () => {
  it('does not render when visible=false', () => {
    const { queryByText } = render(
      <RejectModal visible={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(queryByText('Reject')).toBeNull();
  });

  it('calls onConfirm with empty string when reject pressed without typing', () => {
    const onConfirm = jest.fn();
    const { getByText } = render(
      <RejectModal visible={true} onCancel={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.press(getByText('Reject'));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <RejectModal visible={true} onCancel={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.changeText(getByPlaceholderText('Why? (optional)'), 'photo unclear');
    fireEvent.press(getByText('Reject'));
    expect(onConfirm).toHaveBeenCalledWith('photo unclear');
  });

  it('calls onCancel when Cancel pressed', () => {
    const onCancel = jest.fn();
    const { getByText } = render(
      <RejectModal visible={true} onCancel={onCancel} onConfirm={() => {}} />,
    );
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
